const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');
const { body, validationResult } = require('express-validator');
const { Pool } = require('pg');
const bcrypt = require('bcrypt'); // New requirement

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
  saveUninitialized: false, // Changed to false to only save if auth successful
  cookie: { 
      secure: false, // True in production with HTTPS
      maxAge: 1000 * 60 * 60 * 24 * 7 // 1 Week Session
  } 
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- DATABASE CONNECTION ---
let pool;
const dbConfig = {
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'cohabisafe-db',
};

if (process.env.INSTANCE_CONNECTION_NAME) {
  dbConfig.host = `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`;
} else if (process.env.DATABASE_URL) {
  dbConfig.connectionString = process.env.DATABASE_URL;
}

if (process.env.INSTANCE_CONNECTION_NAME || process.env.DATABASE_URL) {
    pool = new Pool(dbConfig);
    console.log("Attempting connection to Postgres DB...");
} else {
    pool = { query: async () => ({ rows: [] }) };
}

// --- ROUTES ---

// 1. Homepage
app.get('/', (req, res) => res.render('index')); // Assuming you rename index.html to views/index.ejs, or serve static

// 2. Unified Login/Signup Page
app.get('/account-setup', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('account-setup', { errors: [], formData: {} });
});

// SIGN UP Logic
app.post('/account-setup', [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be 6+ chars')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.render('account-setup', { errors: errors.array(), formData: req.body });
    }

    const { email, fullName, phone, password } = req.body;

    try {
        // Check existing
        const userCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return res.render('account-setup', { 
                errors: [{ msg: 'Email already registered. Please sign in.' }], 
                formData: req.body 
            });
        }

        // Hash Password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert
        const result = await pool.query(
            `INSERT INTO users (email, full_name, phone, password_hash, role, status) 
             VALUES ($1, $2, $3, $4, 'renter', 'setup') RETURNING id`,
            [email, fullName, phone, hashedPassword]
        );

        // Login Session
        req.session.userId = result.rows[0].id;
        req.session.userEmail = email;
        
        res.redirect('/quiz/personality');

    } catch (err) {
        console.error(err);
        res.status(500).send("Database Error");
    }
});

// LOGIN Logic
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.password_hash || '');
            
            if (match) {
                req.session.userId = user.id;
                req.session.userEmail = user.email;
                return res.redirect('/dashboard');
            }
        }
        // Login Failed
        res.render('account-setup', { 
            errors: [{ msg: 'Invalid email or password.' }], 
            formData: { email } 
        });

    } catch (err) {
        console.error(err);
        res.redirect('/account-setup');
    }
});

// LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// 3. Dashboard (Account Management)
app.get('/dashboard', async (req, res) => {
    if (!req.session.userId) return res.redirect('/account-setup');
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.userId]);
        const user = result.rows[0];
        res.render('dashboard', { user });
    } catch (err) {
        res.redirect('/account-setup');
    }
});

// 4. Quiz & Progress
app.get('/quiz/personality', (req, res) => {
    if (!req.session.userId) return res.redirect('/account-setup');
    res.render('quiz', { section: 'personality' });
});

app.post('/save-progress', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({error: 'Auth required'});
    try {
        const { answers } = req.body;
        await pool.query(
            `UPDATE users SET quiz_answers = COALESCE(quiz_answers, '{}'::jsonb) || $1 WHERE id = $2`,
            [answers, req.session.userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'DB Error' });
    }
});

// 5. Preferences
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

// OAUTH Placeholders (Requires API Keys)
app.get('/auth/google', (req, res) => {
    res.send("Google Auth not configured yet. Requires GCP Credentials.");
});
app.get('/auth/facebook', (req, res) => {
    res.send("Facebook Auth not configured yet. Requires Meta App ID.");
});

app.listen(port, () => {
  console.log(`CohabiSafe running on port ${port}`);
});