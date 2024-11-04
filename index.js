import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import flash from "connect-flash";
import env from "dotenv";
import passport from "./passportConfig.js";
import router from "./routes.js";

const app = express();
const port = 3000;
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

app.use("/", router);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
