const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    displayName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    
    // ✅ NEW: OTP & Verification Fields
    otp: { type: String },
    otpExpires: { type: Date },
    isVerified: { type: Boolean, default: false }, // Default false rakha hai taaki bina OTP ke login na ho

    // --- IDENTITY (Profile & Banner) ---
    image: { type: String },          // Profile Pic (Base64 String for display)
    imageType: { type: String },      // Mime type (e.g., image/png)
    imageContent: { type: Buffer },   // Profile Pic (Raw Buffer)
    
    bannerImage: { type: String },    // Banner Image (Base64 String)

    bio: { type: String },
    title: { type: String },          // e.g., Student, Developer
    
    // --- PERSONAL DETAILS ---
    dob: { type: Date },
    phone: { type: String },
    location: { type: String },
    skills: { type: [String], default: [] },
    
    // --- SOCIAL LINKS ---
    contacts: {
        linkedin: String,
        github: String,
        twitter: String,
        website: String
    },

    // --- PRIVACY SETTINGS ---
    privacy: {
        showEmail: { type: Boolean, default: false },
        showPhone: { type: Boolean, default: false },
        showDob: { type: Boolean, default: false },
        publicProfile: { type: Boolean, default: true }
    },

    // --- APP APPEARANCE ---
    preferences: {
        theme: { type: String, default: 'dark' }, // 'dark' or 'light'
        textSize: { type: String, default: 'normal' }, // 'small', 'normal', 'large'
        emailNotifs: { type: Boolean, default: true }
    },

    // --- INTERACTIONS ---
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Idea' }],
    
    notifications: [{
        type: { type: String }, 
        senders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
        latestSenderName: String,
        message: String,
        link: String,
        read: { type: Boolean, default: false },
        updatedAt: { type: Date, default: Date.now }
    }],
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);