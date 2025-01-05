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
   import { fileURLToPath } from 'url';
 

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
    const isLoggedIn = req.session && req.session.isLoggedIn;
    const clubs = result.rows;
  
    res.render("home.ejs", { clubs, isLoggedIn  });
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



// Student dashboard route
router.get("/student", ensureAuthenticated, async (req, res) => {
  try {
    const isLoggedIn = req.session && req.session.isLoggedIn;
    const result = await db.query("SELECT * FROM clubs");
    const clubs = result.rows;
   
    res.render("student.ejs", {
      studentName: req.user.student_name,
      rollNumber: req.user.roll_no,
      clubs: clubs, // Pass clubs to the template
      isLoggedIn
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


/// Login handling
router.post("/login", async (req, res, next) => {
  const recaptchaResponse = req.body['g-recaptcha-response'];
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;

  try {
    // Verify reCAPTCHA response
    const response = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaResponse}`
    );
    const data = response.data;

    if (!data.success) {
      req.flash('error', 'reCAPTCHA verification failed. Please try again.');
      return res.redirect("/login");
    }

    // Authenticate user using Passport
    passport.authenticate("local", async (err, user, info) => {
      if (err) {
        console.error("Error during authentication:", err);
        return next(err);
      }

      if (!user) {
        req.flash('error', info.message);
        return res.redirect("/login");
      }

      try {
        const rollNo = user.roll_no;

        // Fetch member details
        const memberDetails = await db.query(
          "SELECT * FROM students JOIN member ON students.roll_no = member.student_roll_no WHERE roll_no = $1",
          [rollNo]
        );
        console.log("Member Details:", memberDetails.rows);

        // Fetch office bearer details
        const obDetails = await db.query(
          "SELECT * FROM students JOIN officebearers ON students.roll_no = officebearers.student_roll_no WHERE roll_no = $1",
          [rollNo]
        );
        console.log("Office Bearer Details:", obDetails.rows);

        // Log in the user
        req.logIn(user, (err) => {
          if (err) {
            console.error("Error logging in user:", err);
            return next(err);
          }

          // Set session variables
          req.session.isLoggedIn = true;
          req.session.userRole = obDetails.rows.length > 0 ? "officebearer" : "member";

          return res.redirect("/student");
        });
      } catch (dbErr) {
        console.error("Database error:", dbErr);
        req.flash('error', 'An error occurred during login. Please try again.');
        res.redirect("/login");
      }
    })(req, res, next);
  } catch (recaptchaErr) {
    console.error("Error verifying reCAPTCHA:", recaptchaErr);
    req.flash('error', 'An error occurred during reCAPTCHA verification. Please try again.');
    res.redirect("/login");
  }
});
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
      return res.redirect('/student'); // Optionally redirect to a fallback
    }
    res.clearCookie('connect.sid'); // Clear session cookie
    res.redirect('/login'); // Redirect to login page
  });
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
router.post("/submit-academic-details", ensureAuthenticated, async (req, res) => {
  const { sem, gpa } = req.body;
  const rollNo = req.user.roll_no;

  try {
   
        

    // Insert the achievement
    await db.query(
      "INSERT INTO Academic  (student_roll_no, sem , gpa) VALUES ($1, $2, $3)",
      [rollNo, sem,gpa ]
    );
    res.redirect("/student");
  } catch (err) {
    console.error("Error submitting achievement:", err);
    req.flash('error', 'An error occurred while submitting the achievement.');
    res.redirect("/student");
  }
});
router.post("/submit-inter-event", ensureAuthenticated, async (req, res) => {
  const {  conducting_organization, inter_event_name, inter_achievements_desc, place_won, certificate_link } = req.body;
  const rollNo = req.user.roll_no;
  try {
    // Insert the inter event details into the database
    await db.query(
      "INSERT INTO Interachievements (roll_no, conducting_organization, inter_event_name, inter_achievements_desc, place_won, certificate_link) VALUES ($1, $2, $3, $4, $5, $6)",
      [rollNo, conducting_organization, inter_event_name, inter_achievements_desc, place_won, certificate_link]
    );
    req.flash('success', 'Inter event details submitted successfully.');
    res.redirect("/student");
  } catch (err) {
    console.error("Error submitting inter event details:", err);
    req.flash('error', 'An error occurred while submitting the inter event details.');
    res.redirect("/student");
  }

  
});

router.post("/submit-intra-achievement", ensureAuthenticated, async (req, res) => {
  const { event_id, achievements_desc, place_won, certificate_link } = req.body;
  const rollNo = req.user.roll_no;
  try {
    // Insert the intra achievement details into the database
    await db.query(
      "INSERT INTO IntraAchievements (event_id, roll_no, achievements_desc, place_won, certificate_link) VALUES ($1, $2, $3, $4, $5)",
      [event_id, rollNo, achievements_desc, place_won, certificate_link]
    );
    req.flash('success', 'Intra achievement details submitted successfully.');
    res.redirect("/student");
  } catch (err) {
    console.error("Error submitting intra achievement details:", err);
    req.flash('error', 'An error occurred while submitting the intra achievement details.');
    res.redirect("/student");
  }
});



// Generate report route
router.post("/generate-report", ensureAuthenticated, async (req, res) => {
  const rollNo = req.user.roll_no;

  try {
    
    const studentResult = await db.query("SELECT * FROM Students WHERE ROLL_NO = $1", [rollNo]);
    const achievementsResult = await db.query("SELECT * FROM Academic WHERE student_roll_no = $1 ORDER BY SEM", [rollNo]);
    const intraAchievementsResult = await db.query(`
      SELECT * 
      FROM IntraAchievements a
      JOIN events e ON a.event_id = e.event_id
      JOIN clubs c ON e.club_id = c.club_id
      WHERE roll_no = $1
    `, [rollNo]);
    const interAchievementsResult = await db.query("SELECT * FROM InterAchievements WHERE roll_no = $1", [rollNo]);
    const cgpaResult = await db.query("SELECT AVG(gpa) as cgpa FROM Academic WHERE student_roll_no = $1", [rollNo]);

    const student = studentResult.rows[0];
    const achievements = achievementsResult.rows;
    const interAchievements = interAchievementsResult.rows;
    const intraAchievements = intraAchievementsResult.rows;
    const cgpa = parseFloat(cgpaResult.rows[0].cgpa).toFixed(2);

    const html = `
      <html>
      <head>
        <style>
    body {
      font-family: Arial, sans-serif;
      margin: 20px;
      line-height: 1.6;
      background-color: #f9f9f9;
      color: #333;
    }
    h1 {
      color: #4CAF50;
      font-size: 24px;
      margin-bottom: 20px;
      text-align: center;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      background-color: #fff;
    }
    table, th, td {
      border: 1px solid #ddd;
    }
    th, td {
      padding: 12px;
      text-align: left;
    }
    th {
      background-color: #4CAF50;
      color: white;
    }
    ul {
      list-style-type: none;
      padding: 0;
    }
    li {
      background: #fff;
      margin: 5px 0;
      padding: 10px;
      border: 1px solid #ddd;
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
    }
    .header img {
      width: 100px;
      height: auto;
    }
    .header h1 {
      margin: 0;
    }
  </style>
      </head>
      <body>
      <div class="header">
    
    <h1>CEG Club Connex</h1>
  </div>
        <h2>Report for ${student.student_name}</h2>
        <table>
          <tr>
            <th>Roll Number</th>
            <td>${student.roll_no}</td>
          </tr>
          <tr>
            <th>Department</th>
            <td>${student.department}</td>
          </tr>
          <tr>
            <th>Contact Number</th>
            <td>${student.contact_no}</td>
          </tr>
          <tr>
            <th>CGPA</th>
            <td>${cgpa}</td>
          </tr>
        </table>
        <h2>Academics</h2>
        <ul>
          ${achievements.map(achievement => `
            <li>
              Semester: ${achievement.sem}, GPA: ${achievement.gpa}
            </li>`).join('')}
        </ul>
       <h2 class="section-title">Inter College Achievements</h2>
        <table>
          <tr>
            <th>Event</th>
            <th>Organization</th>
            <th>Place</th>
            <th>Description</th>
            <th>Certificate</th>
          </tr>
          ${interAchievements.map(achievement => `
            <tr>
              <td>${achievement.inter_event_name}</td>
              <td>${achievement.conducting_organization}</td>
              <td>${achievement.place_won}</td>
              <td>${achievement.inter_achievements_desc}</td>
              <td><a href="${achievement.certificate_link}">Link</a></td>
            </tr>`).join('')}
        </table>
        <h2 class="section-title">CEG College Achievements</h2>
        <table>
          <tr>
            <th>Event ID</th>
            <th>Event name</th>
            <th>Event Date</th>
            <th>Conducting Club</th>
            <th>Description</th>
            <th>Place Won</th>
            <th>Certificate</th>
          </tr>
          ${intraAchievements.map(achievement => `
            <tr>
              <td>${achievement.event_id}</td>
              <td>${achievement.event_name}</td>
              <td>${achievement.event_date}</td>
              <td>${achievement.club_name}</td>
              <td>${achievement.achievements_desc}</td>
              <td>${achievement.place_won}</td>
              <td><a href="${achievement.certificate_link}">Link</a></td>
            </tr>`).join('')}
        </table>
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
  const clubId = req.query.club_id;
  const rollNo = req.user.roll_no;
  
  try {
      // Fetch club details
      const clubResult = await db.query(
          "SELECT * FROM Clubs WHERE CLUB_ID = $1",
          [clubId]
      );
      
      if (clubResult.rows.length === 0) {
          req.flash('error', 'Club not found.');
          return res.redirect("/");
      }
      
      const club = clubResult.rows[0];
      
      // Fetch events
      const eventResult = await db.query(
          "SELECT * FROM Events WHERE club_id = $1 ORDER BY event_date DESC",
          [clubId]
      );
      const events = eventResult.rows;

      const query = await db.query( `
      SELECT * FROM announcements a join events e on a.club_id=e.club_id
      WHERE announcement_type = 'event_announcement'
    `);
    
    
    


      // Modified reply query with correct table names and joins
      const replyResult = await db.query(`
          SELECT 
              feedback_id, 
              reply, 
              roll_no,
              feedback_text
          FROM reply WHERE roll_no = $1 AND club_id = $2
      `, [rollNo, clubId]);
      const replies = replyResult.rows;
      
  
     
      const rows = query.rows;

      console.log(rows);
     
      // Render with all data
      return res.render("non-member.ejs", {
        rollNo: rollNo,
          club: club,
          events: events,
          replies: replies,
          announcements: rows, // Ensure replies is always at least an empty array
          message: replyResult.rows.length === 0 ? "No replies found." : null
      });
      
  } catch (err) {
      console.error("Error in non-member route:", err);
      console.error("Full error details:", err.message);
      if (err.query) {
          console.error("Failed query:", err.query);
      }
      req.flash('error', 'An error occurred while fetching data.');
      return res.redirect("/");
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
      "SELECT student_name, student_roll_no,club_id FROM ClubMembersView WHERE club_id = $1",
      [club_id]
    );
    //Fetch announcements of the club
    const query = await db.query(`
      SELECT * FROM announcements a join events e on a.club_id=e.club_id  
    `);

    // Fetch events for the club
    const eventResult = await db.query(
      "SELECT * FROM Events WHERE club_id = $1",
      [club_id]
    );

    const eventNames = await db.query(`
      SELECT announcements.event_id, announcements.announcement_description, events.event_name 
      FROM announcements 
      JOIN events ON announcements.event_id = events.event_id 
      WHERE announcements.club_id = $1
    `, [club_id]);
     

    const clubResult = await db.query("SELECT * FROM Clubs WHERE CLUB_ID = $1", [club_id]);
    const club = clubResult.rows[0];
    const members = memResult.rows;
    const events = eventResult.rows;
    const eventInfo = eventNames.rows;
    const rows = query.rows;
    console.log(rows);
   
    if (result.rows.length > 0) {
      const memberPassword = result.rows[0].mem_password;

      if (password === memberPassword) {
        // Password is correct, render the member dashboard or relevant page
        res.render("member.ejs", {rollNo:rollNo, club: club, members: members, events: events,announcements: rows,eventInfo: eventInfo,password: memberPassword });
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
    
      return res.redirect("/"); // Redirect to home or login page
    }

    const obResult = await db.query(
      `SELECT ob_post, student_name 
       FROM (
         SELECT ob_post, 
                (SELECT student_name FROM students WHERE roll_no = m.student_roll_no) AS student_name 
         FROM OfficeBearers m 
         WHERE m.club_id = $1
       ) AS subquery`,
      [club_id]
    );
    

    const feedbackResult = await db.query("SELECT f.feedback_id,f.roll_no,f.event_id,f.club_id,f.grievance,e.event_name FROM feedback f,students s,events e,clubs c  WHERE f.roll_no = s.roll_no and e.club_id = c.club_id and f.event_id = e.event_id");
    const clubResult = await db.query("SELECT * FROM Clubs WHERE CLUB_ID = $1", [club_id]);
    const eventResult = await db.query("SELECT * FROM Events e JOIN Clubs c ON c.club_id = e.club_id WHERE e.club_id = $1 order by event_id asc", [club_id]);
    const announcement_result = await db.query('SELECT * FROM announcements  natural join events   where club_id=$1',[club_id]);
    const announcements = announcement_result.rows;
   
    console.log(announcements);
    const club = clubResult.rows[0];
    const obs = obResult.rows;
    const events = eventResult.rows;
    
    const feedback = feedbackResult.rows;
 console.log(feedback);
    if (result.rows.length > 0) {
      const obPassword = result.rows[0].ob_password;

      if (password === obPassword) {
        // Password is correct, render the office bearer dashboard or relevant page
        res.render("ob.ejs", { club, ob: obs, events: events,password: obPassword,feedback: feedback,announcements: announcements });
      } else {
        // Password is incorrect
        req.flash('error', 'Incorrect password. Please try again.');
        console.log("Password mismatch:", password , obPassword);
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


// Route for submitting feedback
router.post('/submitFeedback', async (req, res) => {
  
  const { roll_no, event_id, grievance, userType, club_id } = req.body; // Include club_id in the request body

  try {
    // For non-members, don't require a roll_no (or handle differently)
    let feedbackInsertData = [club_id, event_id, grievance]; 
    let query = "INSERT INTO feedback (club_id, event_id, grievance) VALUES ($1, $2, $3) RETURNING *";
    
    if (userType === 'non_member') {
      feedbackInsertData = [club_id, roll_no, event_id, grievance];
      query = "INSERT INTO feedback (club_id, roll_no, event_id, grievance) VALUES ($1, $2, $3, $4) RETURNING *";
    } else {
      feedbackInsertData = [club_id, roll_no, event_id, grievance];
      query = "INSERT INTO feedback (club_id, roll_no, event_id, grievance) VALUES ($1, $2, $3, $4) RETURNING *";
    }

    // Insert feedback into the database (with or without roll_no)
    const result = await db.query(query, feedbackInsertData);

    
    res.redirect(userType === 'member' ? '/member' : '/non-member'); // Redirect based on user type
  } catch (err) {
    console.error("Error submitting feedback:", err);
    res.status(500).send("An error occurred while submitting feedback.");
  }
});

// Route for submitting a reply to feedback (from ob.ejs)
router.post('/replyFeedback', async (req, res) => {
  const { feedback_id, reply_text } = req.body;

  try {
    // Insert the reply into the temporary table
    await db.query(
      "INSERT INTO temp_replies (feedback_id, reply_text) VALUES ($1, $2)",
      [feedback_id, reply_text]
    );

    // Delete the feedback (trigger will handle inserting the reply into replies table)
    await db.query(
      "DELETE FROM feedback WHERE feedback_id = $1",
      [feedback_id]
    );

    res.redirect('/ob'); // Redirect to office bearer page
  } catch (err) {
    console.error("Error submitting reply:", err);
    res.status(500).send("An error occurred while submitting the reply.");
  }
});



router.post('/add-announcement', async (req, res) => {
  try {
    const { event_id, announcement_type, announcement_description, club_id } = req.body;
    
    const query = `
      INSERT INTO announcements 
      (event_id, announcement_type, announcement_description, club_id) 
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    await db.query(query, [event_id, announcement_type, announcement_description, club_id]);
    
    res.redirect('/ob'); // Redirect back to OB page after submission
  } catch (err) {
    console.error(err);
    res.status(500).send('Error adding announcement');
  }
});

// Route to handle updating an announcement
router.post('/edit-announcement', async (req, res) => {
  try {
    const { event_id, announcement_description, announcement_type, club_id } = req.body;

    const query = `
      UPDATE announcements
      SET announcement_description = $1, announcement_type = $2, club_id = $3
      WHERE event_id = $4
    `;

    await db.query(query, [announcement_description, announcement_type, club_id, event_id]);

    res.redirect('/ob'); // Redirect back to OB page after submission
  } catch (err) {
    console.error(err);
    res.status(500).send('Error updating announcement');
  }
});

// Route to handle deleting an announcement
router.delete('/delete-announcement/:event_id', async (req, res) => {
  try {
    const { event_id } = req.params;

    const query = `
      DELETE FROM announcements
      WHERE event_id = $1
    `;

    await db.query(query, [event_id]);

    res.status(200).send('Announcement deleted');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting announcement');
  }
});


router.post('/addEvent', upload.single('eventImage'), async (req, res) => {
  const { eventName, eventDate, eventVenue, eventTime, eventShortDescription, eventLink, extraCurricular, club_id, password } = req.body; // Ensure all fields are included
  const file = req.file;

  try {
    // Extract the file extension
    const fileExtension = path.extname(file.originalname);
    const targetDir = path.join('D:\\WebDev Projects\\CEG-Club-Connex\\public\\images\\uploads');
    const targetPath = path.join(targetDir, `${file.filename}${fileExtension}`);

    // Ensure the uploads directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Save the image file locally with the correct extension
    fs.renameSync(file.path, targetPath);

    const publicUrl = `/images/uploads/${file.filename}${fileExtension}`; // URL to access the image locally
    const eventTimer = `${eventDate} ${eventTime}:00`;
    // Save the event details to the database
    await db.query(
      "INSERT INTO Events (club_id, event_name, event_date, event_venue, event_time, event_poster_image, event_short_description, event_link, EXTRA_CURRICULAR_OR_NON_CURRICULAR) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [club_id, eventName, eventDate, eventVenue, eventTimer, publicUrl, eventShortDescription, eventLink, extraCurricular]
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
  const { event_id, eventName, eventDate, eventVenue, eventTime, eventShortDescription, eventLink, extraCurricular, club_id, password } = req.body;
  const file = req.file;
  const eventTimer = `${eventDate} ${eventTime}:00`;

  // Validate event_id
  if (!event_id || isNaN(event_id)) {
    req.flash('error', 'Invalid event ID.');
    return res.redirect(`/ob?club_id=${club_id}&password=${password}`);
  }

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

    const values = [eventName, eventDate, eventVenue, eventTimer, eventShortDescription, eventLink, extraCurricular];

    // If a new image is uploaded, handle the file upload
    if (file) {
      const fileExtension = path.extname(file.originalname);
    const targetDir = path.join('D:\\WebDev Projects\\CEG-Club-Connex\\public\\images\\uploads');
    const targetPath = path.join(targetDir, `${file.filename}${fileExtension}`);

    // Ensure the uploads directory exists
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Save the image file locally with the correct extension
    fs.renameSync(file.path, targetPath);

    const publicUrl = `/images/uploads/${file.filename}${fileExtension}`; // URL to access the image locally
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
    res.redirect(`/ob?club_id=${club_id}&password=${password}`);
  } catch (err) {
    console.error("Error updating event:", err);
    req.flash('error', 'An error occurred while updating the event.');
    res.redirect(`/ob?club_id=${club_id}&password=${password}`);
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
    
