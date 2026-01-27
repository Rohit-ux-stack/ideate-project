const express = require('express');
const router = express.Router();
const multer = require('multer');
const ideaController = require('../controllers/ideaController');

// --- MULTER CONFIGURATION (Image Uploads) ---

// 1. Filter: Only accept images
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only images are allowed!'), false);
    }
};

// 2. Setup: Memory Storage + 5MB Limit
const upload = multer({ 
    storage: multer.memoryStorage(),
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit per file
});

// --- MAIN PAGES ---
router.get('/', ideaController.getDashboard);
router.get('/bookmarks', ideaController.getBookmarks);
router.get('/activity', ideaController.getActivity);
router.get('/analytics', ideaController.getAnalytics);
router.get('/post/:id', ideaController.getPostById);

// --- POST CREATION & EDITING ---

// Create Post (Multiple Images)
router.post('/post-idea', upload.array('ideaImages', 5), ideaController.postIdea);

// Edit Post (Get Page & Update Logic)
router.get('/post/:id/edit', ideaController.getEditPost);
router.post('/post/:id/edit', upload.array('ideaImages', 5), ideaController.updatePost);

// --- INTERACTIONS ---
router.get('/post/:id/raise', ideaController.raiseIdea);
router.get('/post/:id/bookmark', ideaController.bookmarkIdea);
router.post('/post/:id/comment', ideaController.postComment);

// Deletion
router.get('/post/:id/delete', ideaController.deleteIdea);
router.get('/post/:id/comment/:commentId/delete', ideaController.deleteComment);

// --- SETTINGS & PROFILE ---
router.get('/profile', (req, res) => res.redirect('/settings'));
router.get('/settings', ideaController.getSettings);
router.post('/settings/update', upload.single('profileImage'), ideaController.updateSettings);

// --- AUTHENTICATION (Login/Signup Fixed) ---

// Login Routes
router.get('/login', ideaController.getLogin);
router.post('/login', ideaController.postLogin);

// Signup Routes
router.get('/signup', ideaController.getSignup);
router.post('/signup', ideaController.postSignup);

// Logout
router.get('/logout', (req, res) => { 
    req.session.destroy(() => res.redirect('/')); 
});

module.exports = router;