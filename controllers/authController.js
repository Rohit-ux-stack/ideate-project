const User = require('../models/User');
const bcrypt = require('bcryptjs');
const sendEmail = require('../utils/sendEmail');

// --- 1. SIGNUP WITH OTP ---
exports.signup = async (req, res) => {
    try {
        const { displayName, email, password } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });

        if (user) {
            // CASE 1: User pehle se hai aur VERIFIED hai -> Error do
            if (user.isVerified) {
                return res.render('pages/signup', { error: 'Email already registered' });
            }
            
            // CASE 2: User hai par VERIFY NAHI kiya (Adhura Signup) -> OTP Update karo aur Resend karo
            console.log("⚠️ Unverified user found. Updating OTP...");
            const hashedPassword = await bcrypt.hash(password, 12);
            const otp = Math.floor(1000 + Math.random() * 9000).toString();
            
            user.displayName = displayName;
            user.password = hashedPassword;
            user.otp = otp;
            user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
            await user.save();

            await sendEmail(email, "Your Ideate Verification Code", otp);
            req.session.tempEmail = email;
            return res.redirect('/verify-otp');
        }

        // CASE 3: New User (Bilkul Naya)
        const hashedPassword = await bcrypt.hash(password, 12);
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

        user = new User({
            displayName,
            email,
            password: hashedPassword,
            otp,
            otpExpires,
            isVerified: false // 🛑 Abhi Verified False hai
        });

        await user.save();
        await sendEmail(email, "Your Ideate Verification Code", otp);

        req.session.tempEmail = email;
        res.redirect('/verify-otp');

    } catch (err) {
        console.error(err);
        res.render('pages/signup', { error: 'Something went wrong' });
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

        // ✅ Verify Success
        user.isVerified = true;
        user.otp = undefined;       
        user.otpExpires = undefined;
        await user.save();

        // Login User
        req.session.userId = user._id;
        req.session.tempEmail = null;

        res.redirect('/'); 

    } catch (err) {
        console.error(err);
        res.render('pages/verifyOtp', { email: req.session.tempEmail, error: 'Verification failed' });
    }
};

// --- 4. LOGIN (Strict Check) ---
exports.login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.render('pages/login', { error: 'Invalid email or password' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.render('pages/login', { error: 'Invalid email or password' });

        // 🛑 CRITICAL FIX: Agar Verified nahi hai, toh login ROKO
        if (!user.isVerified) {
            // OTP wapas bhejo taaki woh verify kar sake
            const otp = Math.floor(1000 + Math.random() * 9000).toString();
            user.otp = otp;
            user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
            await user.save();
            await sendEmail(email, "Verification Code", otp);
            
            req.session.tempEmail = email;
            // Unhe OTP page par bhej do (Login page par OTP box nahi dikhega, seedha redirect hoga)
            return res.redirect('/verify-otp');
        }

        // Login Success
        req.session.userId = user._id;
        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.render('pages/login', { error: 'Login error' });
    }
};

// --- 5. LOGOUT ---
exports.logout = (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
};