const User = require('../models/User');
const bcrypt = require('bcryptjs');
const sendEmail = require('../utils/sendEmail');

// --- 1. SIGNUP WITH OTP ---
exports.signup = async (req, res) => {
    try {
        let { name, username, email, password } = req.body;

        // ✅ 1. USERNAME CLEANUP: Lowercase + No Spaces
        const cleanUsername = username.toLowerCase().replace(/\s/g, '');

        // Regex: Letters, Numbers, Dots, Underscores, Emojis | Length: 3-20
        const usernameRegex = /^[\w.\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]{3,20}$/u;

        if (!usernameRegex.test(cleanUsername)) {
            return res.render('pages/signup', { 
                error: 'Username must be 3-20 characters. No spaces allowed!' 
            });
        }

        // ✅ 2. UNIQUE USERNAME CHECK (Database index must be unique)
        const existingUsername = await User.findOne({ username: cleanUsername });
        if (existingUsername && existingUsername.email !== email.toLowerCase()) {
            return res.render('pages/signup', { error: 'Username already taken. Try another!' });
        }

        // ✅ 3. EMAIL EXISTENCE CHECK
        let user = await User.findOne({ email: email.toLowerCase() });
        const hashedPassword = await bcrypt.hash(password, 12);
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

        if (user) {
            if (user.isVerified) {
                return res.render('pages/signup', { error: 'Email already registered. Try logging in.' });
            }
            // Update unverified user details for retry
            console.log("⚠️ Updating OTP for unverified user...");
            user.displayName = name;
            user.username = cleanUsername;
            user.password = hashedPassword;
            user.otp = otp;
            user.otpExpires = otpExpires;
            await user.save();
        } else {
            // New User Creation
            user = new User({
                displayName: name,
                username: cleanUsername,
                email: email.toLowerCase(),
                password: hashedPassword,
                otp,
                otpExpires,
                isVerified: false 
            });
            await user.save();
        }

        // Bhejo Verification Code
        await sendEmail(email, "Your Ideate Verification Code", otp);
        req.session.tempEmail = email.toLowerCase();
        res.redirect('/verify-otp');

    } catch (err) {
        console.error("Signup Error:", err);
        res.render('pages/signup', { error: 'Something went wrong. Please try again.' });
    }
};

// --- 2. RENDER OTP PAGE ---
exports.renderVerifyPage = (req, res) => {
    if (!req.session.tempEmail) return res.redirect('/signup');
    res.render('pages/verifyOtp', { email: req.session.tempEmail, error: null });
};

// --- 3. VERIFY OTP ---
exports.verifyOtp = async (req, res) => {
    try {
        const { otp } = req.body;
        const email = req.session.tempEmail;
        const user = await User.findOne({ email });

        if (!user) return res.redirect('/signup');

        // Check OTP and Expiry
        if (user.otp !== otp || user.otpExpires < Date.now()) {
            return res.render('pages/verifyOtp', { email, error: 'Invalid or Expired OTP' });
        }

        // Success: Mark verified and Cleanup
        user.isVerified = true;
        user.otp = undefined;       
        user.otpExpires = undefined;
        await user.save();

        // Auto Login after successful verification
        req.session.userId = user._id;
        req.session.tempEmail = null;
        res.redirect('/'); 

    } catch (err) {
        console.error("OTP Error:", err);
        res.render('pages/verifyOtp', { email: req.session.tempEmail, error: 'Verification failed' });
    }
};

// --- 4. LOGIN (Universal: Email or Username) ---
exports.login = async (req, res) => {
    const { identifier, password } = req.body; 
    try {
        const searchId = identifier.toLowerCase().trim();

        // ✅ Check if user exists by Email OR Username
        const user = await User.findOne({ 
            $or: [{ email: searchId }, { username: searchId }] 
        });
        
        if (!user) {
            return res.render('pages/login', { error: 'This email or username is not registered.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('pages/login', { error: 'Incorrect password. Please try again.' });
        }

        // ✅ CRITICAL: OTP Check for unverified users during login attempt
        if (!user.isVerified) {
            const otp = Math.floor(1000 + Math.random() * 9000).toString();
            user.otp = otp;
            user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
            await user.save();
            await sendEmail(user.email, "Verification Code", otp);
            
            req.session.tempEmail = user.email;
            return res.redirect('/verify-otp');
        }

        // Login Success
        req.session.userId = user._id;
        res.redirect('/');
    } catch (err) {
        console.error("Login Error:", err);
        res.render('pages/login', { error: 'An error occurred during login.' });
    }
};

// --- 5. LOGOUT ---
exports.logout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
};