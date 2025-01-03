import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import flash from "connect-flash";
import env from "dotenv";
import passport from "./passportConfig.js";
import router from "./routes.js";
import path from "path"; // Import path module

const app = express();
const port = process.env.PORT; // Use environment variable for port
env.config();

app.use((req, res, next) => {
  res.locals.isLoggedIn = req.session && req.session.isLoggedIn;
  next();
});

// Middleware for session management
app.use(
  session({
    
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === "production" }, // Use secure cookies in production
  })
);

// Middleware for parsing URL-encoded bodies
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the "public" directory
app.use(express.static("public"));

// Serve uploaded files from the "uploads" directory
app.use('/uploads', express.static('c:\\Users\\iitje\\webdev\\ceg\\public\\images\\uploads'));

// Flash messages middleware
app.use(flash());

// Passport authentication middleware
app.use(passport.initialize());
app.use(passport.session());

// Use the router for handling routes
app.use("/", router);

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
// Middleware to prevent browser cache
function noCache(req, res, next) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}

// Apply middleware to protected routes
app.use('/student', noCache);
function isAuthenticated(req, res, next) {
  if (req.session.isLoggedIn) {
    return next();
  }
  res.redirect('/login');
}

// Apply the check to protected routes
app.use('/student', isAuthenticated);
app.get('/student', noCache, (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/login');
  }
  res.render('student');
});
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      return res.redirect('/student');
    }
    res.clearCookie('connect.sid'); // Clear session cookie
    res.redirect('/login');
  });
});


