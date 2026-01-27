const mongoose = require('mongoose');

const IdeaSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    author: { type: String, default: 'Anonymous' },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    
    // YEH SABSE ZAROORI HAI: images ko explicitly array of objects banna hoga
    images: [{
        content: { type: Buffer },
        type: { type: String }
    }],
    
    status: { type: String, default: 'Validation' },
    upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: [] }],
    comments: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        user: String,
        text: String,
        createdAt: { type: Date, default: Date.now }
    }],
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Idea', IdeaSchema);