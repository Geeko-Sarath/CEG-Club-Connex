import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import flash from "connect-flash";
import env from "dotenv";
import axios from "axios"; // Add axios for HTTP requests
import pdf from "html-pdf"; // Add html-pdf for generating PDFs

const app = express();
const port = 3000;
const saltRounds = 10;
env.config();

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        clubs.CLUB_NAME,
        clubs.CLUB_DESCRIPTION,
        OfficeBearers.STUDENT_NAME,
        OfficeBearers.OB_POST,
        OfficeBearers.OB_CONTACT_DETAILS
      FROM 
        clubs
      JOIN 
        OfficeBearers ON clubs.CLUB_ID = OfficeBearers.CLUB_ID
      WHERE 
        OfficeBearers.OB_POST = 'President'
    `);
    const clubs = result.rows;
    res.render("home.ejs", { clubs });
  } catch (err) {
    console.error("Error fetching clubs:", err);
    res.render("home.ejs", { clubs: [] });
  }
});

app.get("/login", (req, res) => {
  res.render("login.ejs", { messages: req.flash() });
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

app.get("/student", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("student.ejs", {
      studentName: req.user.student_name,
      rollNumber: req.user.roll_no
    });
  } else {
    res.redirect("/login");
  }
});

// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

app.post(
  "/login",
  async (req, res, next) => {
    const recaptchaResponse = req.body['g-recaptcha-response'];
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;

    try {
      const response = await axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaResponse}`);
      const data = response.data;

      if (data.success) {
        passport.authenticate("local", (err, user, info) => {
          if (err) {
            return next(err);
          }
          if (!user) {
            req.flash('error', info.message);
            return res.redirect("/login");
          }
          req.logIn(user, (err) => {
            if (err) {
              return next(err);
            }
            return res.redirect("/student");
          });
        })(req, res, next);
      } else {
        req.flash('error', 'reCAPTCHA verification failed. Please try again.');
        res.redirect("/login");
      }
    } catch (err) {
      console.error("Error verifying reCAPTCHA:", err);
      req.flash('error', 'An error occurred during reCAPTCHA verification. Please try again.');
      res.redirect("/login");
    }
  }
);

app.post("/register", async (req, res) => {
  const rollNo = req.body.username; // Using roll number as username
  const password = req.body.password;
  const studentName = req.body.student_name;
  const cgpa = req.body.cgpa;
  const semNo = req.body.sem_no;

  try {
    const checkResult = await db.query("SELECT * FROM Students WHERE ROLL_NO = $1", [
      rollNo,
    ]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO Students (ROLL_NO, STUDENT_NAME, CGPA, SEM_NO, MEMBER_PASSWORD) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [rollNo, studentName, cgpa, semNo, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            if (err) {
              console.error("Error logging in after registration:", err);
            } else {
              res.redirect("/student");
            }
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.post("/submit-achievement", async (req, res) => {
  const { event_id, achievement } = req.body;
  const rollNo = req.user.roll_no;

  try {
    // Check if the event exists
    const eventResult = await db.query("SELECT * FROM Events WHERE EVENT_ID = $1", [event_id]);
    if (eventResult.rows.length === 0) {
      req.flash('error', 'Event ID does not exist.');
      return res.redirect("/student");
    }

    // Insert the achievement
    await db.query(
      "INSERT INTO Achievements (ROLL_NO, EVENT_ID, ACHIEVEMENTS) VALUES ($1, $2, $3)",
      [rollNo, event_id, achievement]
    );
    res.redirect("/student");
  } catch (err) {
    console.error("Error submitting achievement:", err);
    req.flash('error', 'An error occurred while submitting the achievement.');
    res.redirect("/student");
  }
});


app.post("/generate-report", ensureAuthenticated, async (req, res) => {
  const rollNo = req.user.roll_no;

  try {
    const studentResult = await db.query("SELECT * FROM Students WHERE ROLL_NO = $1", [rollNo]);
    const achievementsResult = await db.query("SELECT * FROM Achievements WHERE ROLL_NO = $1", [rollNo]);

    const student = studentResult.rows[0];
    const achievements = achievementsResult.rows;

    const html = `
      <html>
      <head>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
          }
          h1 {
            color: #4CAF50;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          table, th, td {
            border: 1px solid #ddd;
          }
          th, td {
            padding: 8px;
            text-align: left;
          }
          th {
            background-color: #f2f2f2;
          }
          ul {
            list-style-type: none;
            padding: 0;
          }
          li {
            background: #f9f9f9;
            margin: 5px 0;
            padding: 10px;
            border: 1px solid #ddd;
          }
        </style>
      </head>
      <body>
        <h1>Achievements Report for ${student.student_name}</h1>
        <table>
          <tr>
            <th>Roll Number</th>
            <td>${student.roll_no}</td>
          </tr>
          <tr>
            <th>CGPA</th>
            <td>${student.cgpa}</td>
          </tr>
          <tr>
            <th>Semester</th>
            <td>${student.sem_no}</td>
          </tr>
        </table>
        <h2>Achievements</h2>
        <ul>
          ${achievements.map(achievement => `<li>${achievement.achievements}</li>`).join('')}
        </ul>
      </body>
      </html>
    `;

    pdf.create(html).toStream((err, stream) => {
      if (err) {
        console.error("Error generating PDF:", err);
        res.redirect("/student");
      } else {
        res.setHeader('Content-type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=achievements_report.pdf');
        stream.pipe(res);
      }
    });
  } catch (err) {
    console.error("Error generating report:", err);
    res.redirect("/student");
  }
});


passport.use(
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query("SELECT * FROM Students WHERE ROLL_NO = $1", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.member_password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false, { message: "Incorrect password." });
            }
          }
        });
      } else {
        return cb(null, false, { message: "User not found." });
      }
    } catch (err) {
      console.log(err);
      return cb(err);
    }
  })
);

passport.serializeUser((user, cb) => {
  cb(null, user.roll_no);
});

passport.deserializeUser(async (roll_no, cb) => {
  try {
    const result = await db.query("SELECT * FROM Students WHERE ROLL_NO = $1", [roll_no]);
    if (result.rows.length > 0) {
      cb(null, result.rows[0]);
    } else {
      cb("User not found");
    }
  } catch (err) {
    cb(err);
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
