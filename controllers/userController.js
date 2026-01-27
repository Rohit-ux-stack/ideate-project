const User = require('../models/User');
const bcrypt = require('bcryptjs');

exports.postSignup = async (req, res) => {
    try {
        const { displayName, email, password } = req.body;
        // Encryption
        const hashedPassword = await bcrypt.hash(password, 12);
        
        const newUser = new User({
            displayName,
            email,
            password: hashedPassword
        });
        await newUser.save();
        res.redirect('/login');
    } catch (err) { res.status(500).send("Signup Error"); }
};

exports.postLogin = async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        // Set session user here
        res.redirect('/');
    } else { res.status(401).send("Invalid Credentials"); }
};