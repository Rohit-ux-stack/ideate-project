const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Signup
router.get('/signup', (req, res) => res.render('pages/signup', { error: null }));
router.post('/signup', authController.signup);

// Login (Yeh raha wo route jo missing hai)
router.get('/login', (req, res) => res.render('pages/login', { error: null }));
router.post('/login', authController.login); // ✅ YEH LINE ZAROORI HAI

// OTP
router.get('/verify-otp', authController.renderVerifyPage);
router.post('/verify-otp', authController.verifyOtp);

// Logout
router.get('/logout', authController.logout);

module.exports = router;