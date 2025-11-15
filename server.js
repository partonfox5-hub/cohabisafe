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

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Routes

// Home/Landing - Serve existing index.html with CTA
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Onboarding (optional email signup)
app.get('/renter-start', (req, res) => {
  res.render('onboarding', { step: 1, totalSteps: 6 });
});

app.post('/renter-start', [
  body('email').isEmail().normalizeEmail(),
  body('consent').equals('true')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('onboarding', { errors: errors.array(), ...req.body, step: 1, totalSteps: 6 });
  }

  // Save to DB if email provided
  if (req.body.email) {
    const hashedConsent = await bcrypt.hash(req.body.consent, 10);
    await pool.query('INSERT INTO users (email, consent_hash, tier) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING', 
      [req.body.email, hashedConsent, 'basic']);
  }

  // Redirect to tiers (session would be better, but local for now)
  res.redirect('/tiers');
});

// Tier Selection
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

// Quiz Routes
app.get('/quiz/personality', (req, res) => {
  res.render('quiz', { section: 'personality', questions: 35, answered: 0, step: 3, totalSteps: 6 });
});

app.get('/quiz/environment', (req, res) => {
  res.render('quiz', { section: 'environment', questions: 22, answered: 0, step: 3, totalSteps: 6 });
});

app.get('/quiz/building', (req, res) => {
  res.render('quiz', { section: 'building', questions: 10, answered: 0, step: 3, totalSteps: 6 });
});

// Quiz Submit
app.post('/quiz-submit', async (req, res) => {
  const { answers, tier } = req.body; // answers as JSON string from JS

  // Validate 80% answered (client-side, but server check too)
  const totalQs = 67; // 35 + 22 + 10
  const answered = JSON.parse(answers).filter(a => a).length;
  if (answered < totalQs * 0.8) {
    return res.status(400).json({ error: 'Please answer at least 80% of questions.' });
  }

  // Save to DB (assume user session or email)
  await pool.query('UPDATE users SET quiz_answers = $1, tier = $2 WHERE email = $3', 
    [answers, tier || 'basic', req.body.email || 'anonymous']);

  // Calculate mock profile (OCEAN scores)
  const profile = calculateOCEAN(answers); // Implement this function

  res.render('profile', { profile, tier: tier || 'basic', step: 4, totalSteps: 6 });
});

// Elite Signup
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
  const hashedSSN = await bcrypt.hash(ssn, 10);

  // Save pending elite
  await pool.query('INSERT INTO users (email, full_name, ssn_hash, tier) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET ssn_hash = $3, tier = $4', 
    [email, fullName, hashedSSN, 'elite_pending']);

  // Create Stripe session
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

// Stripe Webhook
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

    // Update user status
    await pool.query('UPDATE users SET tier = $1, stripe_session = $2 WHERE email = $3 AND ssn_hash = $4', 
      ['elite_paid', session.id, email, ssn_hash]);
  }

  res.json({received: true});
});

// Success
app.get('/success', async (req, res) => {
  const { session_id } = req.query;
  const session = await stripe.checkout.sessions.retrieve(session_id);
  res.render('success', { step: 5, totalSteps: 6, email: session.metadata.email });
});

// Cancel
app.get('/cancel', (req, res) => {
  res.render('cancel', { step: 5, totalSteps: 6 });
});

// Wait Screen
app.get('/wait-screen', (req, res) => {
  res.render('wait-screen', { step: 6, totalSteps: 6 });
});

// Dashboard
app.get('/dashboard', async (req, res) => {
  // Assume authenticated user
  const userId = req.query.userId || 1; // Mock
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  // Fetch matches (mock for now)
  const matches = await getMatches(user.rows[0].quiz_answers);
  res.render('dashboard', { user: user.rows[0], matches, step: 6, totalSteps: 6 });
});

// Helper Functions
function calculateOCEAN(answers) {
  // Mock OCEAN calculation (reverse scoring, averages)
  const openness = [1, 6 - 2, 3, 4, 5, 6, 7, 8]; // Indices example
  // Implement full logic
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
  // Mock matches using cosine similarity
  return [
    { name: 'John Doe', score: 0.85, profile: 'Adventurous Introvert' },
    { name: 'Jane Smith', score: 0.78, profile: 'Organized Extrovert' }
  ];
}

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
app.listen(port, () => {
  console.log(`Cohabisafe server running on port ${port}`);
});

module.exports = app;