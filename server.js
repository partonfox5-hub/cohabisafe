// Fix navigation issue: Move app.use(express.static('public')); to the VERY END, after all routes and error handling.
// This ensures dynamic routes like /renter-start are handled before falling back to static files.
// Also, add the missing /status route for wait-screen polling.
// Full structure: Middleware (no static), Routes (all GET/POST), Helpers, Error handler, THEN static.

// Replace the entire contents with this updated server.js (includes all previous routes, Stripe, PG, helpers, and fixes):

const express = require('express');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcrypt');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware - Dynamic first (no static yet)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Routes (all dynamic first)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/renter-start', (req, res) => {
  res.render('onboarding', { step: 1, totalSteps: 6 });
});

app.post('/renter-start', [
  body('email').optional().isEmail().normalizeEmail(),
  body('consent').equals('true')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('onboarding', { errors: errors.array(), ...req.body, step: 1, totalSteps: 6 });
  }

  if (req.body.email) {
    const hashedConsent = await bcrypt.hash(req.body.consent, 10);
    await pool.query('INSERT INTO users (email, consent_hash, tier) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING', 
      [req.body.email, hashedConsent, 'basic']);
  }

  res.redirect('/tiers');
});

app.get('/tiers', (req, res) => {
  res.render('tiers', { step: 2, totalSteps: 6 });
});

app.post('/tiers', (req, res) => {
  const { tier } = req.body;
  if (tier === 'basic') {
    res.redirect('/quiz/personality');
  } else if (tier === 'elite') {
    res.redirect('/elite-signup');
  } else {
    res.redirect('/tiers');
  }
});

app.get('/quiz/personality', (req, res) => {
  res.render('quiz', { section: 'personality', questions: 35, answered: 0, step: 3, totalSteps: 6 });
});

app.get('/quiz/environment', (req, res) => {
  res.render('quiz', { section: 'environment', questions: 22, answered: 0, step: 3, totalSteps: 6 });
});

app.get('/quiz/building', (req, res) => {
  res.render('quiz', { section: 'building', questions: 10, answered: 0, step: 3, totalSteps: 6 });
});

app.post('/quiz-submit', async (req, res) => {
  const { answers, tier } = req.body;
  const totalQs = 67;
  const parsedAnswers = JSON.parse(answers || '{}');
  const answered = Object.values(parsedAnswers).filter(a => a && (Array.isArray(a) ? a.length > 0 : a !== '')).length;
  if (answered < totalQs * 0.8) {
    return res.status(400).json({ error: 'Please answer at least 80% of questions.' });
  }

  await pool.query('UPDATE users SET quiz_answers = $1, tier = $2 WHERE email = $3', 
    [answers, tier || 'basic', req.body.email || 'anonymous']);

  const profile = calculateOCEAN(answers);
  res.render('profile', { profile, tier: tier || 'basic', step: 4, totalSteps: 6 });
});

app.get('/elite-signup', (req, res) => {
  res.render('elite-signup', { step: 5, totalSteps: 6 });
});

app.post('/elite-signup', [
  body('ssn').isLength({ min: 9, max: 9 }).withMessage('SSN must be 9 digits'),
  body('email').isEmail(),
  body('fullName').notEmpty(),
  body('consent').equals('true')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('elite-signup', { errors: errors.array(), ...req.body });
  }

  const { ssn, email, fullName } = req.body;
  const hashedSSN = await bcrypt.hash(ssn.replace(/-/g, ''), 10); // Clean SSN

  await pool.query('INSERT INTO users (email, full_name, ssn_hash, tier) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET ssn_hash = $3, tier = $4', 
    [email, fullName, hashedSSN, 'elite_pending']);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Elite Membership - Cohabisafe',
        },
        unit_amount: 8900, // $89.00
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${req.headers.origin}/cancel`,
    metadata: { email, fullName, ssn_hash: hashedSSN },
  });

  res.redirect(303, session.url);
});

app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook Error`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { email, fullName, ssn_hash } = session.metadata;

    await pool.query('UPDATE users SET tier = $1, stripe_session = $2 WHERE email = $3 AND ssn_hash = $4', 
      ['elite_paid', session.id, email, ssn_hash]);
  }

  res.json({received: true});
});

app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  const session = await stripe.checkout.sessions.retrieve(session_id);
  res.render('success', { step: 5, totalSteps: 6, email: session.metadata?.email || 'your email' });
});

app.get('/cancel', (req, res) => {
  res.render('cancel', { step: 5, totalSteps: 6 });
});

app.get('/wait-screen', (req, res) => {
  res.render('wait-screen', { step: 6, totalSteps: 6 });
});

app.get('/status', async (req, res) => {
  const { userId } = req.query;
  const user = await pool.query('SELECT status FROM users WHERE id = $1', [userId || 1]);
  res.json({ status: user.rows[0]?.status || 'processing' });
});

app.get('/dashboard', async (req, res) => {
  const userId = req.query.userId || 1; // Mock; use session in prod
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const matches = await getMatches(user.rows[0]?.quiz_answers || '{}');
  res.render('dashboard', { user: user.rows[0], matches, step: 6, totalSteps: 6 });
});

// Helper Functions
function calculateOCEAN(answers) {
  // Mock OCEAN calculation (expand with full reverse scoring/averages from quiz.js)
  const parsed = JSON.parse(answers || '{}');
  // Example: Average openness questions (Q1-8, reverse Q2/8)
  return {
    openness: 7.2,
    conscientiousness: 6.8,
    extraversion: 5.5,
    agreeableness: 7.0,
    neuroticism: 4.1,
    type: 'Reliable Explorer'
  };
}

async function getMatches(quizAnswers) {
  // Mock matches using cosine similarity on OCEAN
  return [
    { id: 1, name: 'John Doe', score: 0.85, profile: 'Adventurous Introvert' },
    { id: 2, name: 'Jane Smith', score: 0.78, profile: 'Organized Extrovert' }
  ];
}

// Error handling (before static)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Catch-all for 404 (before static)
app.use((req, res) => {
  res.status(404).send('Page not found');
});

// STATIC FILES LAST - After all routes and error handlers
app.use(express.static('public'));

// Start server
app.listen(port, () => {
  console.log(`Cohabisafe server running on port ${port}`);
});

module.exports = app;