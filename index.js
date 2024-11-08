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
