const express = require('express');
const router = express.Router();
const multer = require('multer');
const ideaController = require('../controllers/ideaController');

// --- Multer Config (Image Uploads) ---
const upload = multer({ 
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images allowed!'), false);
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

// ==============================
// 🟢 API & AJAX ROUTES (JSON)
// ==============================
router.get('/api/users/search', ideaController.searchUsers);
router.get('/api/notifications/check', ideaController.checkNotifications);
router.post('/api/notifications/read/:id', ideaController.markNotificationRead);

// ==============================
// 🏠 MAIN PAGES
// ==============================
router.get('/', ideaController.getDashboard);
router.get('/bookmarks', ideaController.getBookmarks);
router.get('/activity', ideaController.getActivity);
router.get('/analytics', ideaController.getAnalytics);
router.get('/notifications', ideaController.getNotifications);
router.get('/leaderboard', ideaController.getLeaderboard); // 🏆 Hall of Fame
router.get('/info/:page', ideaController.getStaticPage);   // ℹ️ About, Rules, etc.

// ==============================
// 📝 POST CREATION & VIEW
// ==============================
router.post('/post-idea', upload.array('ideaImages', 5), ideaController.postIdea); // Create
router.get('/post/:id', ideaController.getPostById); // View Details

// ==============================
// ⚙️ POST ACTIONS (Edit / Delete / Interact)
// ==============================
// Edit
router.get('/post/:id/edit', ideaController.getEditPost);
router.post('/post/:id/edit', upload.array('ideaImages', 5), ideaController.updatePost);

// Delete
router.get('/post/:id/delete', ideaController.deleteIdea);

// Interactions
router.get('/post/:id/raise', ideaController.raiseIdea);     // Like/Upvote
router.get('/post/:id/bookmark', ideaController.bookmarkIdea);

// ==============================
// 💬 COMMENTS & REPLIES
// ==============================
router.post('/post/:id/comment', ideaController.postComment);
router.post('/post/:id/comment/:commentId/reply', ideaController.replyToComment);
router.get('/post/:id/comment/:commentId/delete', ideaController.deleteComment); // Delete Comment
router.post('/post/:id/comment/:commentId/edit', ideaController.updateComment);
// ==============================
// 👤 USER PROFILE & CONNECTIONS
// ==============================
router.get('/user/:id', ideaController.getUserProfile);
router.get('/user/:id/:type', ideaController.getConnections); // Followers/Following List
router.get('/follow/:id', ideaController.followUser);
router.get('/remove-follower/:id', ideaController.removeFollower);
// routes/ideaRoutes.js mein yeh line add karo:
router.get('/fix-usernames', ideaController.fixUsernames);
// ==============================
// 🔧 SETTINGS & ACCOUNT
// ==============================
router.get('/profile', (req, res) => res.redirect('/settings'));
router.get('/settings', ideaController.getSettings);

// Profile Update (Image & Banner)
router.post('/settings/update', upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'bannerImage', maxCount: 1 }
]), ideaController.updateSettings);

router.post('/settings/change-password', ideaController.changePassword);
router.post('/settings/delete-account', ideaController.deleteAccount);
router.get('/fix-db', ideaController.fixDatabase);
module.exports = router;