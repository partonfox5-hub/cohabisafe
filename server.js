/* Remove tiers and elite routes entirely. Simplify to single payment for the service ($49 one-time fee for matching + background check).

Update /renter-start to render new marketing page.

Add new routes for the funnel:
- GET/POST /account-setup: Basic info (email, fullName, phone optional). Save to DB on POST, redirect to quiz.
- GET /quiz/personality: Existing quiz (simplify to single personality section; remove environment/building for now or combine).
- POST /quiz-submit: Save quiz answers to DB (update users table), calculate profile, redirect to /background-consent.
- GET/POST /background-consent: Consent form. On POST, if consented, redirect to /background-info.
- GET/POST /background-info: SSN and consent for check. Hash SSN, update DB, redirect to /payment.
- GET /payment: Render payment page with Stripe button/form to initiate checkout.
- POST /create-checkout-session: Create Stripe session with user data in metadata, redirect to Stripe.
- Update /success: After payment, update DB to 'paid', redirect to /dashboard or wait-screen.
- Remove /tiers, /elite-signup, /elite-signup POST.
- For quiz, assume single /quiz/personality route and /quiz-submit handles it.
- Add user creation in /account-setup POST if not exists.
- Use email as session key; in prod, use proper sessions.
- Set price to 4900 cents ($49).
- Keep /landlord-start similar but stubbed for now.
- Update helper functions if needed. */

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session'); // Add for basic state; install if needed: npm i express-session
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
app.use(session({ secret: process.env.SESSION_SECRET || 'fallback-secret', resave: false, saveUninitialized: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/renter-start', (req, res) => {
  res.render('marketing', { step: 1, totalSteps: 5 }); // New marketing page
});

app.get('/account-setup', (req, res) => {
  res.render('account-setup', { step: 2, totalSteps: 5, errors: [] });
});

app.post('/account-setup', [
  body('email').isEmail().normalizeEmail(),
  body('fullName').notEmpty().trim().escape()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('account-setup', { step: 2, totalSteps: 5, errors: errors.array(), ...req.body });
  }

  const { email, fullName, phone } = req.body;
  const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  
  let userId;
  if (userCheck.rows.length === 0) {
    const result = await pool.query(
      'INSERT INTO users (email, full_name, phone, role, status, tier) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [email, fullName, phone || null, 'renter', 'setup', 'basic']
    );
    userId = result.rows[0].id;
  } else {
    userId = userCheck.rows[0].id;
    await pool.query('UPDATE users SET full_name = $1, phone = $2, role = $3 WHERE id = $4',
      [fullName, phone || null, 'renter', userId]);
  }

  req.session.userId = userId; // Store in session
  res.redirect('/quiz/personality');
});

app.get('/quiz/personality', (req, res) => {
  if (!req.session.userId) return res.redirect('/account-setup');
  res.render('quiz', { section: 'personality', questions: 35, answered: 0, step: 3, totalSteps: 5, userId: req.session.userId });
});

app.post('/quiz-submit', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

  const { answers, email } = req.body;
  const totalQs = 35; // Personality only
  const parsedAnswers = JSON.parse(answers || '{}');
  const answered = Object.values(parsedAnswers).filter(a => a && (Array.isArray(a) ? a.length > 0 : a !== '')).length;
  
  if (answered < totalQs * 0.8) {
    return res.status(400).json({ error: 'Please answer at least 80% of questions.' });
  }

  await pool.query('UPDATE users SET quiz_answers = $1 WHERE id = $2', 
    [answers, req.session.userId]);

  const profile = calculateOCEAN(answers);
  await pool.query('UPDATE users SET profile_summary = $1 WHERE id = $2',
    [JSON.stringify(profile), req.session.userId]);

  res.redirect('/background-consent');
});

app.get('/background-consent', (req, res) => {
  if (!req.session.userId) return res.redirect('/account-setup');
  res.render('background-consent', { step: 4, totalSteps: 5, errors: [] });
});

app.post('/background-consent', [
  body('consent').equals('true')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('background-consent', { step: 4, totalSteps: 5, errors: errors.array(), ...req.body });
  }

  // Save consent
  await pool.query('UPDATE users SET background_consent = NOW(), status = $1 WHERE id = $2',
    ['consented', req.session.userId]);

  res.redirect('/background-info');
});

app.get('/background-info', (req, res) => {
  if (!req.session.userId) return res.redirect('/account-setup');
  res.render('background-info', { step: 4.5, totalSteps: 5, errors: [] }); // Sub-step
});

app.post('/background-info', [
  body('ssn').isLength({ min: 9, max: 9 }).withMessage('SSN must be 9 digits'),
  body('dob').optional().isISO8601() // YYYY-MM-DD
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('background-info', { step: 4.5, totalSteps: 5, errors: errors.array(), ...req.body });
  }

  const { ssn, dob } = req.body;
  const hashedSSN = await bcrypt.hash(ssn.replace(/[^0-9]/g, ''), 10);

  await pool.query('UPDATE users SET ssn_hash = $1, dob = $2, status = $3 WHERE id = $4',
    [hashedSSN, dob || null, 'info_ready', req.session.userId]);

  res.redirect('/payment');
});

app.get('/payment', (req, res) => {
  if (!req.session.userId) return res.redirect('/account-setup');
  res.render('payment', { step: 5, totalSteps: 5, amount: 49 }); // $49
});

app.post('/create-checkout-session', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = await pool.query('SELECT email, full_name FROM users WHERE id = $1', [req.session.userId]);
  if (user.rows.length === 0) return res.status(401).json({ error: 'User not found' });

  const { email, fullName } = user.rows[0];

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'CohabiSafe Renter Membership - Matching + Background Check',
        },
        unit_amount: 4900, // $49.00
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}&userId=${req.session.userId}`,
    cancel_url: `${req.headers.origin}/cancel`,
    metadata: { userId: req.session.userId.toString(), email, fullName },
  });

  res.redirect(303, session.url);
});

// Keep webhook for payment confirmation
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
    const { userId, email } = session.metadata;

    await pool.query('UPDATE users SET status = $1, stripe_session = $2 WHERE id = $3', 
      ['paid', session.id, parseInt(userId)]);
  }

  res.json({received: true});
});

app.get('/success', async (req, res) => {
  const { session_id, userId } = req.query;
  if (session_id) {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    // Confirm payment in DB if needed
  }
  res.render('success', { step: 5, totalSteps: 5, userId });
});

app.get('/cancel', (req, res) => {
  res.render('cancel', { step: 5, totalSteps: 5 });
});

app.get('/dashboard', async (req, res) => {
  if (!req.session.userId) return res.redirect('/account-setup');
  const userId = req.session.userId;
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  const matches = await getMatches(user.rows[0]?.quiz_answers || '{}');
  res.render('dashboard', { user: user.rows[0], matches, step: 5, totalSteps: 5 });
});

// Stub for landlord
app.get('/landlord-start', (req, res) => {
  res.render('marketing', { step: 1, totalSteps: 5, role: 'landlord' }); // Reuse marketing, customize in EJS
});

// Helpers
function calculateOCEAN(answers) {
  const parsed = JSON.parse(answers || '{}');
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
  return [
    { id: 1, name: 'John Doe', score: 0.85, profile: 'Adventurous Introvert' },
    { id: 2, name: 'Jane Smith', score: 0.78, profile: 'Organized Extrovert' }
  ];
}

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.use((req, res) => {
  res.status(404).send('Page not found');
});

// Static last
app.use(express.static('public'));

app.listen(port, () => {
  console.log(`Cohabisafe server running on port ${port}`);
});

module.exports = app;