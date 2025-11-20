const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const { body, validationResult } = require('express-validator');

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: 'cohabisafe_secret_key', // In prod, use process.env.SESSION_SECRET
  resave: false,
  saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- MOCK DATABASE WRAPPER ---
// This prevents the app from crashing if you haven't set up Postgres yet.
const { Pool } = require('pg');
let pool;
if (process.env.DATABASE_URL) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    console.log("Connected to Postgres DB");
} else {
    console.log("No DATABASE_URL found. Using Mock DB mode for testing flow.");
    pool = {
        query: async () => ({ rows: [{ id: 1, email: 'test@test.com' }] }) // Always returns a dummy success
    };
}

// --- ROUTES ---

// 1. Marketing Page
app.get('/renter-start', (req, res) => {
  res.render('marketing'); 
});

// 2. Account Setup (Basic Info)
app.get('/account-setup', (req, res) => {
  res.render('account-setup', { 
    step: 2, 
    totalSteps: 6, 
    errors: [],
    formData: {} 
  });
});

app.post('/account-setup', [
    body('email').isEmail().withMessage('Please enter a valid email'),
    body('fullName').notEmpty().withMessage('Full name is required')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('account-setup', { 
            step: 2, 
            totalSteps: 6, 
            errors: errors.array(), 
            formData: req.body 
        });
    }

    // Mock DB Save
    req.session.userId = 1; 
    req.session.userEmail = req.body.email;
    console.log(`Saving User: ${req.body.email}`);
    
    res.redirect('/quiz/personality');
});

// 3. Personality Quiz
app.get('/quiz/personality', (req, res) => {
    // Ensure we use your complex quiz.ejs structure
    res.render('quiz', { 
        section: 'personality', 
        questions: 35, 
        answered: 0, 
        step: 3, 
        totalSteps: 6 
    });
});

// Handle Quiz Submission
app.post('/quiz-submit', async (req, res) => {
    console.log("Quiz answers received");
    // Here you would calculate the OCEAN score
    res.redirect('/preferences'); 
});

// 4. Preferences (New Step for Environment/Building)
app.get('/preferences', (req, res) => {
    res.render('quiz', { 
        section: 'environment', // Reusing your quiz template for the next section
        questions: 22, 
        answered: 0, 
        step: 4, 
        totalSteps: 6 
    });
});

app.post('/preferences-submit', (req, res) => {
    console.log("Preferences saved");
    res.redirect('/background-gather');
});

// 5. Background Information Gathering
app.get('/background-gather', (req, res) => {
    res.render('background-gather', { step: 5, totalSteps: 6, errors: [] });
});

app.post('/background-gather', [
    body('ssn').isLength({ min: 9 }).withMessage('SSN required for background check'),
    body('consent').equals('true').withMessage('You must consent to the background check')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('background-gather', { step: 5, totalSteps: 6, errors: errors.array() });
    }
    res.redirect('/payment');
});

// 6. Payment Processing
app.get('/payment', (req, res) => {
    res.render('payment', { step: 6, totalSteps: 6 });
});

// Mock Stripe Checkout
app.post('/create-checkout-session', (req, res) => {
    console.log("Initiating Stripe Checkout...");
    // In a real app, this redirects to Stripe. For skeleton, we go to success.
    res.redirect('/success');
});

app.get('/success', (req, res) => {
    res.render('success');
});

// Catch-all for broken links
app.use((req, res) => {
    res.status(404).send("Page not found");
});

app.listen(port, () => {
  console.log(`CohabiSafe running on port ${port}`);
});

app.post('/save-progress', async (req, res) => {
    const { step, answers } = req.body;
    if (req.session.userId) {
        console.log(`Saving progress for User ${req.session.userId}, Step ${step}`);
        // TODO: Update specific columns in DB based on step, or merge into a JSONB column 'quiz_answers'
        // await pool.query('UPDATE users SET quiz_answers = quiz_answers || $1 WHERE id = $2', [answers, req.session.userId]);
    }
    res.json({ success: true });
});

// 1. Preferences Landing Page
app.get('/preferences-start', (req, res) => {
    res.render('preferences-start', { step: 4, totalSteps: 6 });
});

// 2. Amenities Form
app.get('/preferences/amenities', (req, res) => {
    res.render('preferences-amenities', { step: 4, totalSteps: 6 });
});

// 3. Daily Routine Widget
app.get('/preferences/routine', (req, res) => {
    res.render('preferences-routine', { step: 4, totalSteps: 6 });
});