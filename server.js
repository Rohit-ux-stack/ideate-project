const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const User = require('./models/User');

// ✅ FIX: Auth Routes Import (Zaroori hai Login/OTP ke liye)
const authRoutes = require('./routes/authRoutes');
const ideaRoutes = require('./routes/ideaRoutes');

const app = express();

// Database Connection
mongoose.connect('mongodb://localhost:27017/ideateDB')
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.log('❌ DB Error:', err));

// Settings
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session Setup
app.use(session({
    secret: 'ideate_final_secret',
    resave: false,
    saveUninitialized: false
}));

// --- THEME CONFIGURATION (Expanded Style) ---
const themeMap = {
    blue: { 
        name: 'blue',
        bg: 'bg-blue-600', 
        bgHover: 'hover:bg-blue-500', 
        text: 'text-blue-500', 
        textLight: 'text-blue-400',
        border: 'border-blue-500',
        lightBg: 'bg-blue-600/10'
    },
    purple: { 
        name: 'purple',
        bg: 'bg-purple-600', 
        bgHover: 'hover:bg-purple-500', 
        text: 'text-purple-500', 
        textLight: 'text-purple-400',
        border: 'border-purple-500',
        lightBg: 'bg-purple-600/10'
    },
    green: { 
        name: 'green',
        bg: 'bg-emerald-600', 
        bgHover: 'hover:bg-emerald-500', 
        text: 'text-emerald-500', 
        textLight: 'text-emerald-400',
        border: 'border-emerald-500',
        lightBg: 'bg-emerald-600/10'
    }
};

// Global Middleware (User & Theme Loader)
app.use(async (req, res, next) => {
    res.locals.user = null;
    // Default Theme (Blue) if not logged in
    res.locals.theme = themeMap['blue']; 

    if (req.session.userId) {
        try {
            let user = await User.findById(req.session.userId);
            if (user) {
                let userObj = user.toObject();
                // Convert Buffer Image to Base64 for display
                if (userObj.imageContent) {
                    userObj.image = `data:${userObj.imageType};base64,${userObj.imageContent.toString('base64')}`;
                }
                res.locals.user = userObj;
                
                // APPLY USER SELECTED THEME
                const userTheme = user.preferences && user.preferences.theme ? user.preferences.theme : 'blue';
                res.locals.theme = themeMap[userTheme] || themeMap['blue'];
            }
        } catch (e) { console.error(e); }
    }
    next();
});

// ✅ ROUTE CONNECTIONS (Order Important Hai)
app.use('/', authRoutes); // Pehle Auth (Login/Signup/OTP)
app.use('/', ideaRoutes); // Phir Dashboard/Ideas

const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Ideate running on http://localhost:${PORT}`));