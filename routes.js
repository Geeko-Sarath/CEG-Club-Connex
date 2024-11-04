import express from "express";
import ensureAuthenticated from "./ensureAuthenticated.js";
import db from "./db.js";
import pdf from "html-pdf";
import axios from "axios";
import passport from "passport";
import bcrypt from "bcrypt";

const router = express.Router();

router.get("/", async (req, res) => {
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

router.get("/login", (req, res) => {
  res.render("login.ejs", { messages: req.flash() });
});

router.get("/register", (req, res) => {
  res.render("register.ejs");
});

router.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

router.get("/student", ensureAuthenticated, (req, res) => {
  res.render("student.ejs", {
    studentName: req.user.student_name,
    rollNumber: req.user.roll_no
  });
});

router.post(
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

router.post("/register", async (req, res) => {
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

router.post("/submit-achievement", ensureAuthenticated, async (req, res) => {
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

router.post("/generate-report", ensureAuthenticated, async (req, res) => {
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

export default router;
