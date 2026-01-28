const mongoose = require('mongoose');

// Smart Notification Schema
const NotificationSchema = new mongoose.Schema({
    type: { type: String, enum: ['raise', 'comment', 'reply', 'follow', 'mention'], required: true },
    
    // Grouping Logic: Array of senders
    senders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], 
    latestSenderName: String, 
    
    message: String, 
    link: String, 
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now } // To bring updated group to top
});

const UserSchema = new mongoose.Schema({
    displayName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bio: { type: String, default: '' },
    
    contacts: {
        linkedin: { type: String, default: '' },
        github: { type: String, default: '' },
        website: { type: String, default: '' },
        twitter: { type: String, default: '' },
        email: { type: String, default: '' }
    },

    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    notifications: [NotificationSchema],

    image: { type: String },
    imageContent: { type: Buffer },
    imageType: { type: String },
    
    preferences: { theme: { type: String, default: 'dark' } },
    bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Idea' }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);