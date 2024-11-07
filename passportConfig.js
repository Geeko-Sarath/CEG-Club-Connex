import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import db from "./db.js";

passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const result = await db.query("SELECT * FROM Students WHERE ROLL_NO = $1", [username]);
      const user = result.rows[0];

      if (!user) {
        return done(null, false, { message: "Incorrect username." });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) {
        return done(null, false, { message: "Incorrect password." });
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

passport.serializeUser((user, done) => {
  done(null, user.roll_no);
});

passport.deserializeUser(async (roll_no, done) => {
  try {
    const result = await db.query("SELECT * FROM Students WHERE ROLL_NO = $1", [roll_no]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

export default passport;
