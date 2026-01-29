const express = require('express');
const router = express.Router();
const multer = require('multer');
const ideaController = require('../controllers/ideaController');

// Multer Config
const upload = multer({ 
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images allowed!'), false);
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

// --- APIs (Must be top) ---
router.get('/api/users/search', ideaController.searchUsers);
router.get('/api/notifications/check', ideaController.checkNotifications);
router.post('/api/notifications/read/:id', ideaController.markNotificationRead);

// --- MAIN PAGES ---
router.get('/', ideaController.getDashboard);
router.get('/bookmarks', ideaController.getBookmarks);
router.get('/activity', ideaController.getActivity);
router.get('/analytics', ideaController.getAnalytics);
router.get('/notifications', ideaController.getNotifications);

// --- POST VIEW & ACTIONS ---
router.get('/post/:id', ideaController.getPostById);
router.post('/post-idea', upload.array('ideaImages', 5), ideaController.postIdea);
router.get('/post/:id/edit', ideaController.getEditPost);
router.post('/post/:id/edit', upload.array('ideaImages', 5), ideaController.updatePost);
router.get('/post/:id/delete', ideaController.deleteIdea);

// --- INTERACTIONS ---
router.get('/post/:id/raise', ideaController.raiseIdea);
router.get('/post/:id/bookmark', ideaController.bookmarkIdea);
router.post('/post/:id/comment', ideaController.postComment);
router.post('/post/:id/comment/:commentId/reply', ideaController.replyToComment);
router.get('/post/:id/comment/:commentId/delete', ideaController.deleteComment);

// --- USER & PROFILE ---
router.get('/user/:id', ideaController.getUserProfile);
router.get('/user/:id/:type', ideaController.getConnections); // List View
router.get('/follow/:id', ideaController.followUser);

// --- SETTINGS ---
router.get('/profile', (req, res) => res.redirect('/settings'));
router.get('/settings', ideaController.getSettings);
router.post('/settings/update', upload.single('profileImage'), ideaController.updateSettings);
router.post('/settings/change-password', ideaController.changePassword);
router.post('/settings/delete-account', ideaController.deleteAccount);

// --- AUTH ---
router.get('/login', ideaController.getLogin);
router.post('/login', ideaController.postLogin);
router.get('/signup', ideaController.getSignup);
router.post('/signup', ideaController.postSignup);
router.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

// 🏆 Hall of Fame (Leaderboard)
router.get('/leaderboard', ideaController.getLeaderboard);

// ℹ️ Info Pages (About, Contact, Rules, etc.)
router.get('/info/:page', ideaController.getStaticPage);

module.exports = router;