const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 8080;

app.use(express.static('public'));  // Serve static files like quiz.html
app.use(express.json());  // For POST bodies (signup)

// Home/Pricing route
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Cohabisafe</title></head>
      <body>
        <h1>Welcome to Cohabisafe</h1>
        <p>Basic Tier ($29): <a href="/signup-basic">Sign Up</a></p>
        <p>Elite Tier ($79): <a href="/signup-elite">Sign Up</a></p>
        <p><a href="/quiz">Take Quiz</a></p>
      </body>
    </html>
  `);
});

// Quiz route (serves HTML file)
app.get('/quiz', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'quiz.html'));
});

// Basic signup (placeholder—add Stripe later)
app.post('/signup-basic', (req, res) => {
  // TODO: Stripe charge $29, save user to DB
  res.json({ message: 'Basic signup success! Quiz unlocked.' });
});

// Elite signup (with RentPrep placeholder)
app.post('/signup-elite', async (req, res) => {
  const { ssn, email } = req.body;
  // TODO: Stripe charge $79
  // TODO: axios.post to RentPrep API with ssn/email
  res.json({ message: 'Elite signup success! Verification pending.' });
});

app.listen(port, () => {
  console.log(`Cohabisafe listening on port ${port}`);
});