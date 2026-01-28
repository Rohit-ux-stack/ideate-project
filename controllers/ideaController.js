const Idea = require('../models/Idea');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// --- HELPER FUNCTIONS ---

// 1. Grouped Notifications
const createNotification = async (targetUserId, type, contextMessage, link, senderId, senderName) => {
    try {
        if (targetUserId.toString() === senderId.toString()) return; 

        const user = await User.findById(targetUserId);
        
        // Find existing unread notification of same type and link
        const existingNotifIndex = user.notifications.findIndex(n => 
            n.type === type && n.link === link && !n.read
        );

        if (existingNotifIndex > -1) {
            // GROUP IT
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
            // Move to top
            user.notifications.splice(existingNotifIndex, 1);
            user.notifications.unshift(notif);
        } else {
            // CREATE NEW
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

// 2. Handle Mentions
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

// 3. Process Images
const processIdeasImages = (ideas) => {
    return ideas.map(idea => {
        let i = idea.toObject();
        if (i.images && i.images.length > 0) {
            i.images = i.images.map(img => {
                if(img.content && img.type) return { src: `data:${img.type};base64,${img.content.toString('base64')}` };
                return null;
            }).filter(img => img !== null);
        } else { i.images = []; }
        return i;
    });
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
        const search = req.query.q;
        if (!search) return res.json([]);
        const users = await User.find({ displayName: { $regex: search, $options: 'i' } }).select('displayName _id image').limit(5);
        res.json(users);
    } catch (err) { res.json([]); }
};

// --- PAGE CONTROLLERS ---

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
        const rawIdeas = await Idea.find(query).sort({ createdAt: -1 });
        const ideas = processIdeasImages(rawIdeas);
        
        res.render('pages/dashboard', { ideas, user: res.locals.user, currentCategory: category, currentFeed: filterType, pageTitle: filterType === 'explore' ? 'Explore Ideas' : 'My Feed' });
    } catch (err) { res.status(500).send("Error"); }
};

exports.getPostById = async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.session.userId;
        if (userId) { await Idea.updateOne({ _id: postId, viewedBy: { $ne: userId } }, { $push: { viewedBy: userId }, $inc: { views: 1 } }); }
        const idea = await Idea.findById(postId);
        if (!idea) return res.status(404).send("Not Found");
        let ideaObj = idea.toObject();
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
        const rawIdeas = await Idea.find({ authorId: req.params.id }).sort({ createdAt: -1 });
        const ideas = processIdeasImages(rawIdeas);
        res.render('pages/userProfile', { targetUser, ideas, user: res.locals.user, pageTitle: `${targetUser.displayName}'s Profile` });
    } catch (err) { res.redirect('/'); }
};

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

// --- ACTIONS ---

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

// --- SETTINGS & AUTH ---

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
    const user = await User.findById(req.session.userId).populate('bookmarks');
    res.render('pages/dashboard', { ideas: processIdeasImages(user.bookmarks || []), user: res.locals.user, currentCategory: 'Bookmarks', pageTitle: 'Saved' });
};
exports.getActivity = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    const raw = await Idea.find({ authorId: req.session.userId }).sort({createdAt: -1});
    res.render('pages/dashboard', { ideas: processIdeasImages(raw), user: res.locals.user, currentCategory: 'Activity', pageTitle: 'My Activity' });
};
exports.getAnalytics = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    const myIdeas = await Idea.find({ authorId: req.session.userId });
    const stats = { totalViews: myIdeas.reduce((a,c)=>a+c.views,0), totalUpvotes: myIdeas.reduce((a,c)=>a+c.upvotes.length,0), totalComments: myIdeas.reduce((a,c)=>a+c.comments.length,0), ideaCount: myIdeas.length };
    res.render('pages/analytics', { user: res.locals.user, stats, ideas: processIdeasImages(myIdeas) });
};