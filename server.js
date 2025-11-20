const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const { body, validationResult } = require('express-validator');
const { Pool } = require('pg');

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

// --- Middleware ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'cohabisafe_secret_key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using https in production
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- DATABASE CONNECTION ---
let pool;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        // specific SSL settings for Google Cloud SQL if needed
        ssl: { rejectUnauthorized: false } 
    });
    console.log("Attempting connection to Postgres DB...");
} else {
    console.log("WARNING: No DATABASE_URL found. Data will NOT be saved.");
    pool = {
        query: async () => ({ rows: [] }) // Dummy pool to prevent crashes
    };
}

// --- ROUTES ---

// 1. Marketing Page
app.get('/', (req, res) => res.redirect('/renter-start'));
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

    const { email, fullName, phone } = req.body;

    try {
        // Check if user exists
        const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        let userId;

        if (userCheck.rows.length > 0) {
            // Update existing user
            userId = userCheck.rows[0].id;
            await pool.query(
                'UPDATE users SET full_name = $1, phone = $2 WHERE id = $3',
                [fullName, phone, userId]
            );
            console.log(`Updated existing user: ${userId}`);
        } else {
            // Insert new user
            const result = await pool.query(
                'INSERT INTO users (email, full_name, phone, role, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [email, fullName, phone, 'renter', 'setup']
            );
            userId = result.rows[0].id;
            console.log(`Created new user: ${userId}`);
        }

        // Save real ID to session
        req.session.userId = userId;
        req.session.email = email;
        
        res.redirect('/quiz/personality');

    } catch (err) {
        console.error('Database Error on Account Setup:', err);
        res.status(500).send("Database error. Please try again.");
    }
});

// 3. Personality Quiz
app.get('/quiz/personality', (req, res) => {
    if (!req.session.userId) return res.redirect('/account-setup');
    res.render('quiz', { section: 'personality' });
});

// API: Save Quiz Progress (Called by JS between steps)
app.post('/save-progress', async (req, res) => {
    const { step, answers } = req.body;
    
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Session expired' });
    }

    try {
        console.log(`Saving progress for User ${req.session.userId} (Step ${step})`);
        
        // Merge new answers into the existing JSONB column
        // The '||' operator in Postgres merges JSON objects
        await pool.query(
            `UPDATE users 
             SET quiz_answers = COALESCE(quiz_answers, '{}'::jsonb) || $1 
             WHERE id = $2`,
            [answers, req.session.userId]
        );
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving progress:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// 4. Final Quiz Submit (Redirects to Preferences)
app.post('/quiz-submit', async (req, res) => {
    // This route acts as a fallback/finalizer if needed
    res.redirect('/preferences-start'); 
});

// 5. Preferences Flow
app.get('/preferences-start', (req, res) => {
    if (!req.session.userId) return res.redirect('/account-setup');
    res.render('preferences-start');
});

app.get('/preferences/amenities', (req, res) => {
    if (!req.session.userId) return res.redirect('/account-setup');
    res.render('preferences-amenities');
});

app.get('/preferences/routine', (req, res) => {
    if (!req.session.userId) return res.redirect('/account-setup');
    res.render('preferences-routine');
});

// 6. Background & Payment
app.get('/background-gather', (req, res) => {
    if (!req.session.userId) return res.redirect('/account-setup');
    res.render('background-gather', { step: 5, totalSteps: 6, errors: [] });
});

app.post('/background-gather', async (req, res) => {
    // Save background info logic here...
    res.redirect('/payment');
});

app.get('/payment', (req, res) => {
    res.render('payment', { step: 6, totalSteps: 6 });
});

app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/account-setup');
    res.send("Dashboard Placeholder - You made it!");
});

app.listen(port, () => {
  console.log(`CohabiSafe running on port ${port}`);
});