import User from "../models/userModel.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import {
  sendEmailVerificationLink,
  sendPasswordResetLink,
} from "../utils/utils.js";
import SpotifyWebApi from "spotify-web-api-node";
import Language from "../models/languageModel.js";

// 1.Creating user

const createUser = async (req, res, next) => {
  const { first_name, last_name, email, password } = req.body;

  try {
    // Check if any fields are empty
    if (!first_name || !last_name || !email || !password) {
      const error = new Error(
        "Please fill first_name, last_name, email, and password in the body"
      );
      error.statusCode = 400; // Changed to 400 for Bad Request
      return next(error);
    }

    // Check for a valid email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      const error = new Error("Invalid email format");
      error.statusCode = 400; // Changed to 400 for Bad Request
      return next(error);
    }

    // Check if a user is already registered with the same email
    const userExists = await User.findOne({ email });
    if (userExists) {
      const error = new Error("User already exists with this email");
      error.statusCode = 400; // Changed to 400 for Bad Request
      return next(error);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate a token for email verification
    const token = jwt.sign({ email }, process.env.JWT_SECRET, {
      expiresIn: "2h", // Token expires in 2 hours
    });

    // Send verification email
    try {
      const verificationEmailResponse = await sendEmailVerificationLink(
        email,
        token,
        first_name
      );

      if (verificationEmailResponse.error) {
        const error = new Error("Error sending verification email");
        error.statusCode = 500; // Internal Server Error
        return next(error);
      }

      // Create a new user and save to database
      const user = await User.create({
        first_name,
        last_name,
        email,
        password: hashedPassword,
        verify_token: token,
        verify_token_expires: Date.now() + 7200000, // Token expires in 2 hours
      });

      // Return a success response
      return res.status(201).json({
        message:
          "Registered successfully. Please check your email for the verification link.",
      });
    } catch (emailError) {
      // Handle error in email sending
      return next(emailError);
    }
  } catch (err) {
    // Catch any errors that occur in the try block
    return next(err);
  }
};

// 2. Verifing email--we will get the "Get" request to here
const verifyEmail = async (req, res, next) => {
  try {
    // console.log(req.params.verify_token);
    const user = await User.findOne({ verify_token: req.params.verify_token });
    if (!user) {
      return res.status(404).send("User not found so,Invalid token");
    } else if (user.verify_token_expires <= Date.now()) {
      if (!user.verified) {
        await user.deleteOne();
        return res
          .status(409)
          .send("Verification link is expired.Please register again");
      } else {
        return res.status(409).send("Please login to continue");
      }
    } else if (user.verified === true) {
      return res.status(200).json({
        status: "success",
        message: "Email already verified. Please login.",
      });
    } else {
      user.verified = true;
      await user.save();
      return res.status(201).json({
        status: "success",
        message: "Email verified successfully. Please login.",
      });
    }
  } catch (error) {
    return next(error);
  }
};

// 3. Login User
const loginUser = async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    const err = new Error("Please enter both email and password");
    err.statusCode = 400;
    return next(err);
  }

  //Checking for vaild email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400);
    const err = new Error("Invalid email");
    err.statusCode = 400;
    return next(err);
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }
    if (!user.verified) {
      const err = new Error(
        "Email verification is pending .So,please first verify your email"
      );
      err.statusCode = 409;
      return next(err);
    }
    console.log("username is correct");

    //Password Checking
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      const err = new Error("Invalid password");
      err.statusCode = 401;
      return next(err);
    }
    console.log("Password is correct");

    //Token Generation
    const token = jwt.sign(
      { userId: user._id, email, password },
      process.env.JWT_SECRET,
      {
        expiresIn: 2592000,
      }
    );
    user.token = token;
    await user.save();

    //Generate spotify token

    const spotifyAPI = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    });

    const spotifyCredentials = await spotifyAPI.clientCredentialsGrant();
    //   console.log(spotifyCredentials);

    const spotifyToken = spotifyCredentials.body;
    //This is for clinet purpose
    const expiresIn = 2592000;
    console.log("Spotify api is generated");
    res.status(200).json({ token, spotifyToken, expiresIn });
  } catch (error) {
    return next(error);
  }
};

// 4. Refresh token :Generating newspotify token when it was  expired
const generateSpotifyRefreshToken = async (req, res, next) => {
  try {
    const spotifyAPI = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    });

    const spotifyCredentials = await spotifyAPI.clientCredentialsGrant();
    const spotifyToken = spotifyCredentials.body;

    console.log("Spotify api is re- generated");
    res.status(200).json({ spotifyToken });
  } catch (error) {
    const err = new Error("Something went wrong, please try again");
    err.statusCode = 401;
    return next(err);
  }
};

// 5. User profile endpoint
const getUserProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }

    const profileData = {
      _id: user._id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      languages: user.languages,
    };

    res.status(200).json({ profileData });
  } catch (error) {
    return next(error);
  }
};

// 6. Updating the user profile
const updateUserProfile = async (req, res, next) => {
  const { first_name, last_name, email } = req.body;
  if (!(first_name || last_name || email)) {
    res.send("Enter first_name or last_name or email for updation");
  }
  try {
    const user = await User.findById(req.user._id);
    console.log("Error");

    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }

    if (first_name || last_name) {
      user.first_name = first_name || user.first_name;
      user.last_name = last_name || user.last_name;
    }

    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        const err = new Error(
          "Email already exists .Please choose a different email"
        );
        err.statusCode = 400;
        return next(err);
      }
      user.email = email;
    }
    await user.save();
    res.status(200).json({ message: "Updated Successfully" });
  } catch (error) {
    return next(error);
  }
};

// 7. Updating the prefered languages
const updatePreferedLanguage = async (req, res, next) => {
  let { languageIds } = req.body;

  // Ensure languageIds is an array (empty or with values)
  if (!Array.isArray(languageIds)) {
    languageIds = []; // Default to an empty array if languageIds is missing or invalid
  }

  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }

    // If languageIds is empty, set languages to the default language ["en"] or an empty array
    if (languageIds.length === 0) {
      user.languages = ["en"]; // Default to ["en"] if no languages selected
    } else {
      user.languages = languageIds; // Update with the selected languages
    }

    await user.save();

    res
      .status(200)
      .json({ message: "Preferred Language Updated Successfully" });
  } catch (error) {
    return next(error);
  }
};

// 8. Updating the password
const updatePassword = async (req, res, next) => {
  // const { password, confirmPassword } = req.body;
  const { password } = req.body;

  if (!password) {
    const err = new Error("Password is required");
    err.statusCode = 400;
    return next(err);
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }
    // if (password !== confirmPassword) {
    //   const err = new Error("Passwords do not match");
    //   err.statusCode = 400;
    //   return next(err);
    // }
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    await user.save();
    res.status(200).json({ message: "Password Updated Successfully" });
  } catch (error) {
    return next(error);
  }
};

// 9. reset for forgot password
const forgotPassword = async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    const err = new Error("Email is required");
    err.statusCode = 400;
    return next(err);
  }
  try {
    const user = await User.findOne({ email });
    if (!user) {
      const err = new Error("User email not found");
      err.statusCode = 404;
      return next(err);
    }
    //Generate token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });

    //save token in database
    user.reset_password_token = token;
    user.reset_password_expires = Date.now() + 7200000;
    await user.save();

    //sending mail
    const verificationEmailResponse = await sendPasswordResetLink(
      email,
      token,
      user.first_name
    );

    //Handling errors
    if (verificationEmailResponse.error) {
      const err = new Error(verificationEmailResponse.message);
      err.statusCode = 500;
      return next(err);
    }
    res.status(200).json({ message: "Password reset link sent to your email" });
  } catch (error) {
    return next(error);
  }
};

// 10 .Reset password
const resetPassword = async (req, res, next) => {
  const { token } = req.params;
  const { password } = req.body;

  if (!token) {
    const err = new Error("Invalid token");
    err.statusCode = 400;
    return next(err); // Global error handler should handle this and send a response
  }

  if (!password) {
    const err = new Error("Password is required");
    err.statusCode = 400;
    return next(err); // Global error handler should handle this and send a response
  }

  // Finding the user through token
  try {
    const user = await User.findOne({
      reset_password_token: token,
      reset_password_expires: { $gt: Date.now() },
    });
    if (!user) {
      const err = new Error("Password reset link is invalid or has expired");
      err.statusCode = 400;
      return next(err); // Global error handler should handle this and send a response
    }

    // User found, so hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    user.reset_password_token = undefined;
    user.reset_password_expires = undefined;
    await user.save();
    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Error while resetting password:", error); // Log any error during the process
    res.status(500).json({
      error: "An error occurred while resetting the password", // Proper error response structure
    });
  }
};

// 11 .Saving the spotifystory
const saveSpotifyStory = async (req, res, next) => {
  const { storyId } = req.body;
  if (!storyId) {
    const err = new Error("Story id is required");
    err.statusCode = 400;
    return next(err);
  }
  try {
    const user = await User.findOne(req.user._id);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }
    //Checking if story is already there or not
    if (user.saved_stories.includes(storyId)) {
      return res.status(200).json({ message: "Story already saved" });
    }
    //Saving the story
    user.saved_stories.push(storyId);
    await user.save();
    res.status(200).json({ message: "Story saved successfully" });
  } catch (error) {
    return next(error);
  }
};

// 12 Removing the spotifystory
const removeSpotifyStory = async (req, res, next) => {
  const { storyId } = req.body;
  if (!storyId) {
    const err = new Error("Story id is required");
    err.statusCode = 400;
    return next(err);
  }
  try {
    const user = await User.findOne(req.user._id);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }
    //Checking if story is present or not
    if (!user.saved_stories.includes(storyId)) {
      return res.status(200).json({ message: "Story is not present in db" });
    } else {
      //Removing the story
      user.saved_stories.pull(storyId);
      await user.save();
      res.status(200).json({ message: "Story removed successfully" });
    }
  } catch (error) {
    return next(error);
  }
};

// 13. Getting all the saved spotifystories list
const getSpotifyStories = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      const err = new Error("User not found");
      err.statusCode = 404;
      return next(err);
    }
    const stories = user.saved_stories;
    res.status(200).json({ stories });
  } catch (error) {
    return next(error);
  }
};

export {
  createUser,
  verifyEmail,
  loginUser,
  generateSpotifyRefreshToken,
  getUserProfile,
  updateUserProfile,
  updatePreferedLanguage,
  updatePassword,
  forgotPassword,
  resetPassword,
  saveSpotifyStory,
  removeSpotifyStory,
  getSpotifyStories,
};
