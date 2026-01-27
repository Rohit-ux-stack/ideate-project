const Idea = require('../models/Idea');
const User = require('../models/User');
const bcrypt = require('bcryptjs'); // Bcrypt yahan import hona chahiye

// Helper: Convert binary images to viewable Base64 strings
const processIdeasImages = (ideas) => {
    return ideas.map(idea => {
        let i = idea.toObject();
        if (i.images && i.images.length > 0) {
            i.images = i.images.map(img => {
                if(img.content && img.type) {
                    return { src: `data:${img.type};base64,${img.content.toString('base64')}` };
                }
                return null;
            }).filter(img => img !== null);
        } else { i.images = []; }
        return i;
    });
};

// --- MAIN FUNCTIONS ---

exports.getDashboard = async (req, res) => {
    try {
        const category = req.query.category || 'All';
        let query = {};
        if (category !== 'All') query.category = category;

        const rawIdeas = await Idea.find(query).sort({ createdAt: -1 });
        const ideas = processIdeasImages(rawIdeas);
        
        res.render('pages/dashboard', { 
            ideas, user: res.locals.user, 
            currentCategory: category, 
            pageTitle: category === 'All' ? 'Trending Innovations' : `${category} Ideas`
        });
    } catch (err) { res.status(500).send("Dashboard Error"); }
};

exports.postIdea = async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');
        const { title, description, category } = req.body;
        
        const newIdea = new Idea({
            title, description, category,
            author: res.locals.user.displayName,
            authorId: req.session.userId,
            images: []
        });

        if (req.files && req.files.length > 0) {
            req.files.forEach(file => {
                newIdea.images.push({ content: file.buffer, type: file.mimetype });
            });
        }

        await newIdea.save();
        res.redirect('/');
    } catch (err) { res.status(500).send("Error Posting Idea: " + err.message); }
};

exports.getPostById = async (req, res) => {
    try {
        const idea = await Idea.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
        if (!idea) return res.status(404).send("Not Found");
        
        let ideaObj = idea.toObject();
        if (ideaObj.images && ideaObj.images.length > 0) {
            ideaObj.images = ideaObj.images.map(img => ({
                src: `data:${img.type};base64,${img.content.toString('base64')}`
            }));
        } else { ideaObj.images = []; }

        res.render('pages/postDetail', { idea: ideaObj, user: res.locals.user });
    } catch (err) { res.redirect('/'); }
};

exports.getEditPost = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const idea = await Idea.findById(req.params.id);
        if (idea.authorId.toString() !== req.session.userId) return res.redirect('/');
        res.render('pages/editPost', { idea, user: res.locals.user });
    } catch (err) { res.redirect('/'); }
};

exports.updatePost = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const { title, description, category } = req.body;
        const idea = await Idea.findById(req.params.id);
        
        if (idea.authorId.toString() !== req.session.userId) return res.redirect('/');

        idea.title = title;
        idea.description = description;
        idea.category = category;

        if (req.files && req.files.length > 0) {
            idea.images = [];
            req.files.forEach(file => {
                idea.images.push({ content: file.buffer, type: file.mimetype });
            });
        }

        await idea.save();
        res.redirect(`/post/${idea._id}`);
    } catch (err) { res.status(500).send("Update Error: " + err.message); }
};

// --- INTERACTIONS ---

exports.raiseIdea = async (req, res) => {
    if (!req.session.userId) return res.status(401).send("Login Required");
    try {
        const idea = await Idea.findById(req.params.id);
        const userId = req.session.userId;
        if (idea.upvotes.includes(userId)) idea.upvotes.pull(userId);
        else idea.upvotes.push(userId);
        await idea.save();
        res.redirect(req.get('Referer') || '/');
    } catch (err) { res.redirect('/'); }
};

exports.bookmarkIdea = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId);
        const ideaId = req.params.id;
        if (user.bookmarks.includes(ideaId)) user.bookmarks.pull(ideaId);
        else user.bookmarks.push(ideaId);
        await user.save();
        res.redirect(req.get('Referer') || '/');
    } catch (err) { res.redirect('/'); }
};

exports.postComment = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        await Idea.findByIdAndUpdate(req.params.id, {
            $push: { comments: { userId: req.session.userId, user: res.locals.user.displayName, text: req.body.comment } }
        });
        res.redirect(`/post/${req.params.id}`);
    } catch (err) { res.redirect('/'); }
};

exports.deleteIdea = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const idea = await Idea.findById(req.params.id);
        if (idea && idea.authorId.toString() === req.session.userId) await Idea.findByIdAndDelete(req.params.id);
        res.redirect('/'); 
    } catch (err) { res.redirect('/'); }
};

exports.deleteComment = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const { id, commentId } = req.params;
        await Idea.findByIdAndUpdate(id, { $pull: { comments: { _id: commentId, userId: req.session.userId } } });
        res.redirect(`/post/${id}`);
    } catch (err) { res.redirect(`/post/${req.params.id}`); }
};

// --- SETTINGS & PAGES ---

exports.getSettings = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    res.render('pages/settings', { user: res.locals.user, success: req.query.status === 'success', error: req.query.status === 'error' });
};

exports.updateSettings = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const { displayName, bio, theme } = req.body;
        const updateData = { displayName, bio, 'preferences.theme': theme };
        if (req.file) {
            updateData.imageContent = req.file.buffer;
            updateData.imageType = req.file.mimetype;
            updateData.image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        }
        await User.findByIdAndUpdate(req.session.userId, { $set: updateData });
        res.redirect('/settings?status=success');
    } catch (err) { res.redirect('/settings?status=error'); }
};

exports.getBookmarks = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId).populate('bookmarks');
        const ideas = processIdeasImages(user.bookmarks || []);
        res.render('pages/dashboard', { ideas, user: res.locals.user, currentCategory: 'Bookmarks', pageTitle: 'Saved Ideas' });
    } catch (err) { res.redirect('/'); }
};

exports.getActivity = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const rawIdeas = await Idea.find({ authorId: req.session.userId }).sort({ createdAt: -1 });
        const ideas = processIdeasImages(rawIdeas);
        res.render('pages/dashboard', { ideas, user: res.locals.user, currentCategory: 'Activity', pageTitle: 'My Activity' });
    } catch (err) { res.redirect('/'); }
};

exports.getAnalytics = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const myIdeas = await Idea.find({ authorId: req.session.userId });
        const totalViews = myIdeas.reduce((acc, curr) => acc + curr.views, 0);
        const totalUpvotes = myIdeas.reduce((acc, curr) => acc + curr.upvotes.length, 0);
        const totalComments = myIdeas.reduce((acc, curr) => acc + curr.comments.length, 0);
        res.render('pages/analytics', { user: res.locals.user, stats: { totalViews, totalUpvotes, totalComments, ideaCount: myIdeas.length }, ideas: processIdeasImages(myIdeas) });
    } catch (err) { res.redirect('/'); }
};

// --- AUTHENTICATION (LOGIN FIX IS HERE) ---

// 1. Show Login Page
exports.getLogin = (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('pages/login', { error: null });
};

// 2. Handle Login (Error Fix)
exports.postLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (user && await bcrypt.compare(password, user.password)) {
            // Success
            req.session.userId = user._id;
            res.redirect('/');
        } else {
            // FIX: Render page with Error instead of res.send()
            res.render('pages/login', { error: "Invalid email or password." });
        }
    } catch (err) {
        console.error(err);
        res.render('pages/login', { error: "Something went wrong. Please try again." });
    }
};
// 3. Show Signup Page (FIX: Error null bhejo shuru mein)
exports.getSignup = (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('pages/signup', { error: null });
};

// 4. Handle Signup (FIX: Check Existing User & Render Error)
exports.postSignup = async (req, res) => {
    try {
        const { displayName, email, password } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            // Yahan hum redirect nahi karenge, page render karenge error ke saath
            return res.render('pages/signup', { error: "Account with this email already exists." });
        }

        // Create New User
        const hashedPassword = await bcrypt.hash(password, 12);
        const newUser = new User({ displayName, email, password: hashedPassword });
        await newUser.save();
        
        // Redirect to Login
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.render('pages/signup', { error: "Signup failed due to server error." });
    }
};