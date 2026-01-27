const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    displayName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    bio: { type: String, default: '' },
    image: { type: String, default: 'https://cdn-icons-png.flaticon.com/512/149/149071.png' },
    imageContent: { type: Buffer },
    imageType: { type: String },
    bookmarks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Idea', default: [] }],
    
    // UPDATED: Only Theme remains in preferences
    preferences: {
        theme: { type: String, default: 'blue' } // Options: blue, purple, green
    },
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);