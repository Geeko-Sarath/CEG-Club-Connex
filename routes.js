import express from "express"; 
import ensureAuthenticated from "./ensureAuthenticated.js"; 
import db from "./db.js"; 
import pdf from "html-pdf";
 import axios from "axios"; 
 import passport from "passport";
  import bcrypt from "bcrypt";
   import multer from "multer";
   import path from 'path';
   import fs from 'fs';
 

const router = express.Router();
const saltRounds = 10; // Define salt rounds for password hashing

const upload = multer({ dest: 'uploads/', // Save uploaded files in the 'uploads' directory 
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB file size limit 
  });
// Home route
router.get("/", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        clubs.CLUB_NAME,
        clubs.CLUB_DESCRIPTION,
        students.STUDENT_NAME,
        OfficeBearers.OB_POST,
        OfficeBearers.OB_CONTACT_DETAILS
      FROM 
        clubs
      JOIN 
        OfficeBearers ON clubs.CLUB_ID = OfficeBearers.CLUB_ID
        join
        students on OFFICEBEARERS.STUDENT_ROLL_NO = students.ROLL_NO
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

// Login route
router.get("/login", (req, res) => {
  res.render("login.ejs", { messages: req.flash() });
});

// Registration route
router.get("/register", (req, res) => {
  res.render("register.ejs");
});

// Logout route
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

// Student dashboard route
router.get("/student", ensureAuthenticated, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM clubs");
    const clubs = result.rows;
    console.log(clubs); // Fetch clubs from the database
    res.render("student.ejs", {
      studentName: req.user.student_name,
      rollNumber: req.user.roll_no,
      clubs: clubs // Pass clubs to the template
    });
  } catch (err) {
    console.error("Error fetching clubs:", err);
    res.render("student.ejs", {
      studentName: req.user.student_name,
      rollNumber: req.user.roll_no,
      clubs: [] // Pass an empty array if there's an error
    });
  }
});


// Login handling
router.post("/login", async (req, res, next) => {
  const recaptchaResponse = req.body['g-recaptcha-response'];
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;

  try {
    const response = await axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaResponse}`);
    const data = response.data;

    if (data.success) {
      passport.authenticate("local",async (err, user, info) => {
        if (err) {
          return next(err);
        }
        if (!user) {
          req.flash('error', info.message);
          return res.redirect("/login");
        }
        const rollNo=user.roll_no;
        const memberDetails = await db.query("SELECT * FROM students join member on students.roll_no = member.student_roll_no WHERE ROLL_NO = $1", [rollNo]);
       console.log(memberDetails.rows);
       const obdetails = await db.query("SELECT * FROM students join officebearers on students.roll_no = officebearers.student_roll_no WHERE ROLL_NO = $1",[rollNo]);
       console.log(obdetails.rows);
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
});


// Registration handling
// Registration handling
router.post("/register", async (req, res) => {
  const rollNo = req.body.username; // Using roll number as username
  const password = req.body.password;
  const studentName = req.body.student_name;
  const department = req.body.department;
  const contact_no = req.body.contact_no;
  try {
    const checkResult = await db.query("SELECT * FROM Students WHERE ROLL_NO = $1", [rollNo]);

    if (checkResult.rows.length > 0) {
      req.flash('error', 'Roll number already exists. Please log in.');
      return res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
          return res.redirect("/register");
        } else {
          await db.query(
            "INSERT INTO Students (ROLL_NO, STUDENT_NAME,DEPARTMENT,CONTACT_NO,PASSWORD) VALUES ($1, $2, $3,$4,$5)",
            [rollNo, studentName,department,contact_no, hash]
          );
          // Registration success message
          req.flash('success', 'Registration successful! Please log in with your credentials.');
          
          res.redirect("/"); // Redirect to home page
        }
      });
    }
  } catch (err) {
    console.log(err);
    req.flash('error', 'An error occurred during registration. Please try again.');
    res.redirect("/register");
  }
});


// Submit achievement route
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

// Generate report route
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
        req.flash('error', 'An error occurred while generating the report.');
        return res.redirect("/student");
      } else {
        res.setHeader('Content-type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=achievements_report.pdf');
        stream.pipe(res);
      }
    });
  } catch (err) {
    console.error("Error generating report:", err);
    req.flash('error', 'An error occurred while generating the report.');
    res.redirect("/student");
  }
});


// Non-member route
router.get("/non-member", async (req, res) => {
  const clubId = req.query.club_id; // Get club_id from query parameters
  try {
    const result = await db.query("SELECT * FROM Clubs WHERE CLUB_ID = $1", [clubId]);
    const club = result.rows[0];
    console.log(club); // Assuming club ID is stored in user session

    if (!club) {
      req.flash('error', 'Club not found.');
      return res.redirect("/"); // Redirect if club not found
    }

    res.render("non-member.ejs", { club }); // Render the non-member view with club details
  } catch (err) {
    console.error("Error fetching club details:", err);
    req.flash('error', 'An error occurred while fetching club details.');
    res.redirect("/");
  }
});


// Member route
// Member route
router.get("/member", ensureAuthenticated, async (req, res) => {
  const { password, club_id } = req.query; // Get password and club ID from query parameters
  const rollNo = req.user.roll_no; // Assuming roll number is stored in user session

  try {
    // Fetch the user's hashed password from the database
    const result = await db.query("SELECT mem_password FROM member WHERE student_roll_no = $1", [rollNo]);
    
    // Ensure club_id is defined
    if (!club_id) {
      req.flash('error', 'Club ID is required.');
      return res.redirect("/"); // Redirect to home or login page
    }

    // Fetch members of the club
    const memResult = await db.query(
      "SELECT m.STUDENT_ROLL_NO, s.student_name FROM member m JOIN students s ON m.student_roll_no = s.roll_no WHERE club_id = $1",
      [club_id]
    );

    // Fetch events for the club
    const eventResult = await db.query(
      "SELECT * FROM Events WHERE club_id = $1",
      [club_id]
    );

    const clubResult = await db.query("SELECT * FROM Clubs WHERE CLUB_ID = $1", [club_id]);
    const club = clubResult.rows[0];
    const members = memResult.rows;
    const events = eventResult.rows;

    if (result.rows.length > 0) {
      const memberPassword = result.rows[0].mem_password;

      if (password === memberPassword) {
        // Password is correct, render the member dashboard or relevant page
        res.render("member.ejs", { club: club, members: members, events: events });
      } else {
        // Password is incorrect
        req.flash('error', 'Incorrect password. Please try again.');
        console.log("Password mismatch:", password, memberPassword);
        res.redirect("/"); // Redirect to home or login page
      }
    } else {
      // User not found
      req.flash('error', 'User not found.');
      console.log("User not found for roll number:", rollNo);
      res.redirect("/"); // Redirect to home or login page
    }
  } catch (err) {
    console.error("Error verifying password:", err);
    req.flash('error', 'An error occurred while verifying the password.');
    res.redirect("/"); // Redirect to home or login page
  }
});


// Office Bearer route
router.get("/ob", ensureAuthenticated, async (req, res) => {
  const { password, club_id } = req.query; // Get password and club ID from query parameters
  const rollNo = req.user.roll_no; // Assuming roll number is stored in user session

  try {
    // Fetch the user's hashed password from the database
    const result = await db.query("SELECT ob_password FROM OfficeBearers WHERE student_roll_no = $1", [rollNo]);

    // Ensure club_id is defined
    if (!club_id) {
      req.flash('error', 'Club ID is required.');
      console.log("inside ob and ");
      return res.redirect("/"); // Redirect to home or login page
    }

    const obResult = await db.query(
      "SELECT m.ob_post, s.student_name FROM OfficeBearers m JOIN students s ON m.student_roll_no = s.roll_no WHERE m.club_id = $1",
      [club_id]
    );

    const clubResult = await db.query("SELECT * FROM Clubs WHERE CLUB_ID = $1", [club_id]);
    const eventResult = await db.query("SELECT * FROM Events e JOIN Clubs c ON c.club_id = e.club_id WHERE e.club_id = $1 order by event_id asc", [club_id]);
    
    const club = clubResult.rows[0];
    const obs = obResult.rows;
    const events = eventResult.rows;
    console.log(password);

    if (result.rows.length > 0) {
      const obPassword = result.rows[0].ob_password;

      if (password === obPassword) {
        // Password is correct, render the office bearer dashboard or relevant page
        res.render("ob.ejs", { club, ob: obs, events: events,password: obPassword });
      } else {
        // Password is incorrect
        req.flash('error', 'Incorrect password. Please try again.');
        console.log("Password mismatch:", password," hello" , obPassword);
        res.redirect("/"); // Redirect to home or login page
      }
    } else {
      // User not found
      req.flash('error', 'User not found.');
      console.log("User not found for roll number:", rollNo);
      res.redirect("/"); // Redirect to home or login page
    }
  } catch (err) {
    console.error("Error verifying password:", err);
    req.flash('error', 'An error occurred while verifying the password.');
    res.redirect("/"); // Redirect to home or login page
  }
});




// Route to handle adding an event
router.post('/addEvent', upload.single('eventImage'), async (req, res) => {
  const { eventName, eventDate, eventVenue, eventTime, eventShortDescription, eventLink, extraCurricular, club_id, password } = req.body; // Ensure all fields are included
  const file = req.file;

  try {
    // Save the image file locally
    const targetPath = path.join('c:\\Users\\iitje\\webdev\\ceg\\public\\images\\uploads', file.originalname);
    fs.renameSync(file.path, targetPath);

    const publicUrl = `/uploads/${file.originalname}`; // URL to access the image locally

    // Save the event details to the database
    await db.query(
      "INSERT INTO Events (club_id, event_name, event_date, event_venue, event_time, event_poster_image, event_short_description, event_link, EXTRA_CURRICULAR_OR_NON_CURRICULAR) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [club_id, eventName, eventDate, eventVenue, eventTime, publicUrl, eventShortDescription, eventLink, extraCurricular]
    );

    req.flash('success', 'Event added successfully!');
    console.log("Event added successfully");
    res.redirect(`/ob?club_id=${club_id}&password=${password}`); // Pass club_id and password in the query string
  } catch (err) {
    console.error("Error adding event:", err);
    req.flash('error', 'An error occurred while adding the event.');
    res.redirect(`/ob?club_id=${club_id}&password=${password}`); // Pass club_id and password in the query string
  }
});

router.post('/editEvent', upload.single('eventImage'), async (req, res) => {
  const { event_id, eventName, eventDate, eventVenue, eventTime, eventShortDescription, eventLink, extraCurricular, club_id, password } = req.body; // Ensure all fields are included
  const file = req.file;
  console.log("edit router hit");

  try {
    // Prepare the query to update the event
    let updateQuery = `
      UPDATE Events 
      SET 
        event_name = $1, 
        event_date = $2, 
        event_venue = $3, 
        event_time = $4, 
        event_short_description = $5, 
        event_link = $6, 
        EXTRA_CURRICULAR_OR_NON_CURRICULAR = $7
    `;

    const values = [eventName, eventDate, eventVenue, eventTime, eventShortDescription, eventLink, extraCurricular];

    // If a new image is uploaded, handle the file upload
    if (file) {
      // Save the new image file locally
      const targetPath = path.join('c:\\Users\\iitje\\webdev\\ceg\\public\\images\\uploads', file.originalname);
      fs.renameSync(file.path, targetPath);

      const publicUrl = `/uploads/${file.originalname}`; // URL to access the image locally
      // Add the image URL to the update query
      updateQuery += ", event_poster_image = $8 WHERE event_id = $9";
      values.push(publicUrl, event_id);
    } else {
      // If no new image is uploaded, just update the other fields
      updateQuery += " WHERE event_id = $8";
      values.push(event_id);
    }

    // Execute the update query
    await db.query(updateQuery, values);

    req.flash('success', 'Event updated successfully!');
    console.log("Event updated successfully");
    res.redirect(`/ob?club_id=${club_id}&password=${password}`); // Redirect back to the OB page with club_id and password
  } catch (err) {
    console.error("Error updating event:", err);
    req.flash('error', 'An error occurred while updating the event.');
    res.redirect(`/ob?club_id=${club_id}&password=${password}`); // Redirect back to the OB page with club_id and password
  }
});

router.post('/deleteEvent', async (req, res) => {
  const { event_id, club_id, password } = req.body; // Ensure all fields are included

  try {
    // Delete the event from the database
    await db.query("DELETE FROM Events WHERE event_id = $1", [event_id]);

    req.flash('success', 'Event deleted successfully!');
    console.log("Event deleted successfully");
    res.redirect(`/ob?club_id=${club_id}&password=${password}`); // Redirect back to the OB page with club_id and password
  } catch (err) {
    console.error("Error deleting event:", err);
    req.flash('error', 'An error occurred while deleting the event.');
    res.redirect(`/ob?club_id=${club_id}&password=${password}`); // Redirect back to the OB page with club_id and password
  }
});




export default router;






