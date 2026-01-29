const Idea = require('../models/Idea');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// --- HELPER: Process Images & Attach Author Image ---
// Yeh function Image data ko clean karta hai aur Author PFP ko extract karta hai
const processIdeasData = (ideas) => {
    return ideas.map(idea => {
        let i = idea.toObject ? idea.toObject() : idea;

        // 1. Process Post Images (Buffer -> Base64)
        if (i.images && i.images.length > 0) {
            i.images = i.images.map(img => {
                if(img.content && img.type) return { src: `data:${img.type};base64,${img.content.toString('base64')}` };
                return null;
            }).filter(img => img !== null);
        } else { i.images = []; }

        // 2. Extract Author Image safely (The PFP Logic)
        // Hum check karte hain agar authorId populated hai (object hai) aur usme image hai
        if (i.authorId && i.authorId.image) {
            i.authorImage = i.authorId.image; // Image ko top level pe le aao
            i.authorId = i.authorId._id; // Wapas ID string bana do taaki link kharab na ho
        } else if (i.authorId && i.authorId._id) {
             // Agar populate hua par image nahi hai
             i.authorId = i.authorId._id;
        }

        return i;
    });
};

// --- NOTIFICATION SYSTEM ---

const createNotification = async (targetUserId, type, contextMessage, link, senderId, senderName) => {
    try {
        if (targetUserId.toString() === senderId.toString()) return; 
        const user = await User.findById(targetUserId);
        
        // Smart Grouping Logic
        const existingNotifIndex = user.notifications.findIndex(n => n.type === type && n.link === link && !n.read);

        if (existingNotifIndex > -1) {
            const notif = user.notifications[existingNotifIndex];
            if (!notif.senders.includes(senderId)) {
                notif.senders.push(senderId);
                notif.latestSenderName = senderName;
                notif.updatedAt = Date.now();
                
                const count = notif.senders.length;
                if (count === 2) notif.message = `and 1 other ${contextMessage}`;
                else if (count > 2) notif.message = `and ${count - 1} others ${contextMessage}`;
                else notif.message = contextMessage;
            }
            user.notifications.splice(existingNotifIndex, 1);
            user.notifications.unshift(notif);
        } else {
            user.notifications.unshift({
                type,
                senders: [senderId],
                latestSenderName: senderName,
                message: contextMessage,
                link,
                read: false,
                updatedAt: Date.now()
            });
        }
        await user.save();
    } catch (err) { console.error("Notification Error:", err); }
};

const handleMentions = async (text, ideaId, senderId, senderName) => {
    const mentionRegex = /@(\w+)/g;
    const matches = text.match(mentionRegex);
    if (!matches) return;

    for (const match of matches) {
        const username = match.substring(1); 
        const targetUser = await User.findOne({ displayName: username });
        if (targetUser) {
            await createNotification(targetUser._id, 'mention', `mentioned you in a comment`, `/post/${ideaId}`, senderId, senderName);
        }
    }
};

// --- API HANDLERS ---

exports.checkNotifications = async (req, res) => {
    if (!req.session.userId) return res.json({ count: 0 });
    try {
        const user = await User.findById(req.session.userId);
        const unreadCount = user.notifications.filter(n => !n.read).length;
        res.json({ count: unreadCount });
    } catch (err) { res.json({ count: 0 }); }
};

exports.markNotificationRead = async (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    try {
        await User.updateOne({ _id: req.session.userId, "notifications._id": req.params.id }, { $set: { "notifications.$.read": true } });
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
};

exports.searchUsers = async (req, res) => {
    try {
        // Redirect Logic for Mentions/Comments
        if (req.query.find) {
            const targetUser = await User.findOne({ displayName: req.query.find });
            if (targetUser) return res.redirect(`/user/${targetUser._id}`);
            return res.redirect(req.get('Referer') || '/');
        }

        // Dropdown Search Logic
        const search = req.query.q;
        if (!search) return res.json([]);
        const users = await User.find({ displayName: { $regex: search, $options: 'i' } }).select('displayName _id image').limit(5);
        res.json(users);
    } catch (err) { 
        if (req.query.find) return res.redirect('/');
        res.json([]); 
    }
};

// --- PAGE CONTROLLERS (UPDATED FOR PFP) ---

exports.getDashboard = async (req, res) => {
    try {
        const currentUserId = req.session.userId;
        const filterType = req.query.feed || 'home';
        const category = req.query.category || 'All';
        let query = {};
        if (category !== 'All') query.category = category;

        if (currentUserId && filterType === 'home') {
            const currentUser = await User.findById(currentUserId);
            const followingIds = currentUser.following;
            followingIds.push(currentUserId);
            query.authorId = { $in: followingIds };
        } 
        
        // PFP FIX: Populate authorId to get Image
        const rawIdeas = await Idea.find(query)
            .sort({ createdAt: -1 })
            .populate('authorId', 'displayName image'); 

        const ideas = processIdeasData(rawIdeas);
        
        res.render('pages/dashboard', { ideas, user: res.locals.user, currentCategory: category, currentFeed: filterType, pageTitle: filterType === 'explore' ? 'Explore Ideas' : 'My Feed' });
    } catch (err) { res.status(500).send("Error"); }
};

exports.getPostById = async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.session.userId;

        if (userId) { 
            await Idea.updateOne({ _id: postId, viewedBy: { $ne: userId } }, { $push: { viewedBy: userId }, $inc: { views: 1 } }); 
        }

        // PFP FIX: Populate Main Author + Comments + Replies
        const idea = await Idea.findById(postId)
            .populate('authorId', 'displayName image') // Main Post Author PFP
            .populate({ path: 'comments.userId', select: 'displayName image' })
            .populate({ path: 'comments.replies.userId', select: 'displayName image' });

        if (!idea) return res.status(404).send("Not Found");

        // Custom processing for single object (Manual PFP extraction)
        let ideaObj = idea.toObject();
        
        // 1. Fix Main Author Image
        if(ideaObj.authorId && ideaObj.authorId.image) {
            ideaObj.authorImage = ideaObj.authorId.image;
            ideaObj.authorId = ideaObj.authorId._id;
        }

        // 2. Fix Post Images
        if (ideaObj.images && ideaObj.images.length > 0) {
            ideaObj.images = ideaObj.images.map(img => ({ src: `data:${img.type};base64,${img.content.toString('base64')}` }));
        } else { ideaObj.images = []; }

        res.render('pages/postDetail', { idea: ideaObj, user: res.locals.user });
    } catch (err) { res.redirect('/'); }
};

exports.getUserProfile = async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.id);
        if (!targetUser) return res.redirect('/'); 
        
        // PFP FIX for Contribution List
        const rawIdeas = await Idea.find({ authorId: req.params.id })
            .sort({ createdAt: -1 })
            .populate('authorId', 'image'); // Populate only image needed for processing

        const ideas = processIdeasData(rawIdeas);
        res.render('pages/userProfile', { targetUser, ideas, user: res.locals.user, pageTitle: `${targetUser.displayName}'s Profile` });
    } catch (err) { res.redirect('/'); }
};

exports.getBookmarks = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    // PFP FIX: Nested Populate for Bookmarked Idea Authors
    const user = await User.findById(req.session.userId)
        .populate({
            path: 'bookmarks',
            populate: { path: 'authorId', select: 'displayName image' }
        });
    res.render('pages/dashboard', { ideas: processIdeasData(user.bookmarks || []), user: res.locals.user, currentCategory: 'Bookmarks', pageTitle: 'Saved' });
};

exports.getActivity = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    // PFP FIX
    const raw = await Idea.find({ authorId: req.session.userId })
        .sort({createdAt: -1})
        .populate('authorId', 'displayName image');
    res.render('pages/dashboard', { ideas: processIdeasData(raw), user: res.locals.user, currentCategory: 'Activity', pageTitle: 'My Activity' });
};

exports.getAnalytics = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    // PFP FIX for Top Performers List
    const myIdeas = await Idea.find({ authorId: req.session.userId })
        .populate('authorId', 'displayName image');

    const stats = { totalViews: myIdeas.reduce((a,c)=>a+c.views,0), totalUpvotes: myIdeas.reduce((a,c)=>a+c.upvotes.length,0), totalComments: myIdeas.reduce((a,c)=>a+c.comments.length,0), ideaCount: myIdeas.length };
    res.render('pages/analytics', { user: res.locals.user, stats, ideas: processIdeasData(myIdeas) });
};

// --- REST OF THE FUNCTIONS (Standard) ---

exports.getConnections = async (req, res) => {
    try {
        const type = req.params.type; 
        const targetUser = await User.findById(req.params.id).populate(type, 'displayName image bio followers');
        if (!targetUser) return res.redirect('/');
        res.render('pages/connections', { user: res.locals.user, targetUser, list: targetUser[type], type, pageTitle: `${targetUser.displayName}'s ${type}` });
    } catch (err) { res.redirect('back'); }
};

exports.getNotifications = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId).populate({ path: 'notifications.senders', select: 'displayName image _id' });
        const sortedNotifs = user.notifications.sort((a, b) => b.updatedAt - a.updatedAt);
        res.render('pages/notifications', { user: res.locals.user, notifications: sortedNotifs, pageTitle: 'Notifications' });
    } catch (err) { res.redirect('/'); }
};

exports.followUser = async (req, res) => {
    if (!req.session.userId) return res.json({ error: "Login required" });
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.session.userId;
        if (targetUserId === currentUserId) return res.json({ success: false });

        const currentUser = await User.findById(currentUserId);
        const targetUser = await User.findById(targetUserId);

        let isFollowing = false;
        if (currentUser.following.includes(targetUserId)) {
            currentUser.following.pull(targetUserId);
            targetUser.followers.pull(currentUserId);
            isFollowing = false;
        } else {
            currentUser.following.push(targetUserId);
            targetUser.followers.push(currentUserId);
            await createNotification(targetUserId, 'follow', 'started following you', `/user/${currentUserId}`, currentUserId, currentUser.displayName);
            isFollowing = true;
        }
        await currentUser.save();
        await targetUser.save();
        res.json({ success: true, isFollowing, newCount: targetUser.followers.length });
    } catch (err) { res.json({ success: false }); }
};

exports.postComment = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required!" });
    try {
        const text = req.body.comment;
        const idea = await Idea.findByIdAndUpdate(req.params.id, { $push: { comments: { userId: req.session.userId, user: res.locals.user.displayName, text } } }, { new: true });
        await createNotification(idea.authorId, 'comment', `commented on your idea`, `/post/${idea._id}`, req.session.userId, res.locals.user.displayName);
        await handleMentions(text, idea._id, req.session.userId, res.locals.user.displayName);
        res.redirect(`/post/${req.params.id}`);
    } catch (err) { res.redirect('/'); }
};

exports.replyToComment = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required!" });
    try {
        const { id, commentId } = req.params;
        const text = req.body.reply;
        const idea = await Idea.findById(id);
        const comment = idea.comments.id(commentId);
        if (comment) {
            comment.replies.push({ userId: req.session.userId, user: res.locals.user.displayName, text });
            await idea.save();
            await createNotification(comment.userId, 'reply', `replied to your comment`, `/post/${id}`, req.session.userId, res.locals.user.displayName);
            await handleMentions(text, id, req.session.userId, res.locals.user.displayName);
        }
        res.redirect(`/post/${id}`);
    } catch (err) { res.redirect('back'); }
};

exports.raiseIdea = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required!" });
    try {
        const idea = await Idea.findById(req.params.id);
        const userId = req.session.userId;
        if (idea.upvotes.includes(userId)) { idea.upvotes.pull(userId); } 
        else { 
            idea.upvotes.push(userId);
            await createNotification(idea.authorId, 'raise', `raised your idea`, `/post/${idea._id}`, userId, res.locals.user.displayName);
        }
        await idea.save();
        res.redirect(req.get('Referer') || '/');
    } catch (err) { res.redirect('/'); }
};

exports.bookmarkIdea = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required!" });
    const user = await User.findById(req.session.userId);
    if (user.bookmarks.includes(req.params.id)) user.bookmarks.pull(req.params.id);
    else user.bookmarks.push(req.params.id);
    await user.save();
    res.redirect(req.get('Referer') || '/');
};

exports.postIdea = async (req, res) => {
    try {
        if (!req.session.userId) return res.redirect('/login');
        const newIdea = new Idea({ ...req.body, author: res.locals.user.displayName, authorId: req.session.userId, images: [] });
        if (req.files) req.files.forEach(f => newIdea.images.push({ content: f.buffer, type: f.mimetype }));
        await newIdea.save();
        res.redirect('/');
    } catch (err) { res.status(500).send(err.message); }
};

exports.updatePost = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const idea = await Idea.findById(req.params.id);
    if (idea.authorId.toString() !== req.session.userId) return res.redirect('/');
    idea.title = req.body.title; idea.description = req.body.description; idea.category = req.body.category;
    if (req.files && req.files.length > 0) {
        idea.images = []; req.files.forEach(f => idea.images.push({ content: f.buffer, type: f.mimetype }));
    }
    await idea.save();
    res.redirect(`/post/${idea._id}`);
};

exports.deleteIdea = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const idea = await Idea.findById(req.params.id);
    if (idea && idea.authorId.toString() === req.session.userId) await Idea.findByIdAndDelete(req.params.id);
    res.redirect('/'); 
};

exports.deleteComment = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const { id, commentId } = req.params;
    await Idea.findByIdAndUpdate(id, { $pull: { comments: { _id: commentId, userId: req.session.userId } } });
    res.redirect(`/post/${id}`);
};

exports.getEditPost = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    const idea = await Idea.findById(req.params.id);
    if (idea.authorId.toString() !== req.session.userId) return res.redirect('/');
    res.render('pages/editPost', { idea, user: res.locals.user });
};

exports.getSettings = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    let msg = null;
    if (req.query.status === 'success') msg = { type: 'success', text: 'Profile updated!' };
    if (req.query.status === 'pass_success') msg = { type: 'success', text: 'Password changed successfully!' };
    if (req.query.status === 'pass_error') msg = { type: 'error', text: 'Incorrect current password.' };
    res.render('pages/settings', { user: res.locals.user, message: msg });
};

exports.updateSettings = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const { displayName, bio, theme, linkedin, github, website, twitter, email } = req.body;
        const updateData = { displayName, bio, 'preferences.theme': theme, contacts: { linkedin, github, website, twitter, email } };
        if (req.file) {
            updateData.imageContent = req.file.buffer;
            updateData.imageType = req.file.mimetype;
            updateData.image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        }
        await User.findByIdAndUpdate(req.session.userId, { $set: updateData });
        res.redirect('/settings?status=success');
    } catch (err) { res.redirect('/settings?status=error'); }
};

exports.changePassword = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.session.userId);
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) { return res.redirect('/settings?status=pass_error'); }
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        user.password = hashedPassword;
        await user.save();
        res.redirect('/settings?status=pass_success');
    } catch (err) { res.redirect('/settings?status=error'); }
};

exports.deleteAccount = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const userId = req.session.userId;
        await Idea.deleteMany({ authorId: userId });
        await User.updateMany({}, { $pull: { followers: userId, following: userId } });
        await User.findByIdAndDelete(userId);
        req.session.destroy(() => { res.redirect('/'); });
    } catch (err) { res.redirect('/settings'); }
};

exports.getLogin = (req, res) => res.render('pages/login', { error: null });
exports.postLogin = async (req, res) => {
    const user = await User.findOne({ email: req.body.email });
    if (user && await bcrypt.compare(req.body.password, user.password)) { req.session.userId = user._id; res.redirect('/'); }
    else res.render('pages/login', { error: "Invalid creds" });
};
exports.getSignup = (req, res) => res.render('pages/signup', { error: null });
exports.postSignup = async (req, res) => {
    if(await User.findOne({email: req.body.email})) return res.render('pages/signup', { error: "Exists" });
    const hp = await bcrypt.hash(req.body.password, 12);
    await new User({ ...req.body, password: hp }).save(); res.redirect('/login');
};
exports.getBookmarks = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId).populate({
            path: 'bookmarks',
            populate: { path: 'authorId', select: 'displayName image' }
        });
    res.render('pages/dashboard', { ideas: processIdeasData(user.bookmarks || []), user: res.locals.user, currentCategory: 'Bookmarks', pageTitle: 'Saved' });
};
exports.getActivity = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    const raw = await Idea.find({ authorId: req.session.userId }).sort({createdAt: -1}).populate('authorId', 'displayName image');
    res.render('pages/dashboard', { ideas: processIdeasData(raw), user: res.locals.user, currentCategory: 'Activity', pageTitle: 'My Activity' });
};
exports.getAnalytics = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    const myIdeas = await Idea.find({ authorId: req.session.userId }).populate('authorId', 'displayName image');
    const stats = { totalViews: myIdeas.reduce((a,c)=>a+c.views,0), totalUpvotes: myIdeas.reduce((a,c)=>a+c.upvotes.length,0), totalComments: myIdeas.reduce((a,c)=>a+c.comments.length,0), ideaCount: myIdeas.length };
    res.render('pages/analytics', { user: res.locals.user, stats, ideas: processIdeasData(myIdeas) });
};
// --- LEADERBOARD & STATIC PAGES ---

// 1. Get Hall of Fame (Calculates Top Users based on Total Upvotes Received)
exports.getLeaderboard = async (req, res) => {
    try {
        // Aggregation Pipeline: Users ke saare ideas dhoondo, unke upvotes count karo
        const leaderboard = await Idea.aggregate([
            { $group: { 
                _id: "$authorId", 
                totalUpvotes: { $sum: { $size: "$upvotes" } },
                totalIdeas: { $sum: 1 },
                authorName: { $first: "$author" } // Backup name
            }},
            { $sort: { totalUpvotes: -1 } }, // Highest upvotes first
            { $limit: 10 } // Top 10 only
        ]);

        // Author details (Image etc.) populate karne ke liye
        await User.populate(leaderboard, { path: "_id", select: "displayName image bio" });

        res.render('pages/leaderboard', { 
            users: leaderboard, 
            user: res.locals.user, 
            pageTitle: 'Hall of Fame 🏆' 
        });
    } catch (err) { console.error(err); res.redirect('/'); }
};

// 2. Smart Static Page Handler (Handles About, FAQ, Terms, etc. in ONE function)
exports.getStaticPage = (req, res) => {
    const page = req.params.page; // URL se page ka naam milega (e.g., 'about', 'faq')
    const titles = {
        'about': 'About Us',
        'contact': 'Contact Us',
        'how-to-use': 'How to Use Ideate',
        'guidelines': 'Community Guidelines',
        'faq': 'Frequently Asked Questions',
        'terms': 'Terms & Conditions',
        'privacy': 'Privacy Policy'
    };

    // Agar page list mein hai toh render karo, warna 404/Home
    if (titles[page]) {
        res.render(`pages/info/${page}`, { 
            user: res.locals.user, 
            pageTitle: titles[page] 
        });
    } else {
        res.redirect('/');
    }
};