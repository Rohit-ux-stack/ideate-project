const Idea = require('../models/Idea');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// --- HELPER: Process Images & Attach Author Info ---
const processIdeasData = (ideas) => {
    return ideas.map(idea => {
        let i = idea.toObject ? idea.toObject() : idea;

        // 1. Process Post Images
        if (i.images && i.images.length > 0) {
            i.images = i.images.map(img => {
                if(img.content && img.type) return { src: `data:${img.type};base64,${img.content.toString('base64')}` };
                return null;
            }).filter(img => img !== null);
        } else { i.images = []; }

        // 2. Extract Author Info safely
        if (i.authorId && i.authorId.image) {
            i.authorImage = i.authorId.image;
            i.authorUsername = i.authorId.username; 
            i.authorId = i.authorId._id;
        } else if (i.authorId && i.authorId._id) {
             i.authorUsername = i.authorId.username;
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
                type, senders: [senderId], latestSenderName: senderName, message: contextMessage, link, read: false, updatedAt: Date.now()
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
        const targetUser = await User.findOne({ username: username.toLowerCase() });
        if (targetUser) await createNotification(targetUser._id, 'mention', `mentioned you in a comment`, `/post/${ideaId}`, senderId, senderName);
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
        const search = req.query.q;
        if (!search) return res.json([]);
        const users = await User.find({ 
            $or: [
                { displayName: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } }
            ]
        }).select('displayName username _id image').limit(5);
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
            if (currentUser) {
                const followingIds = currentUser.following;
                followingIds.push(currentUserId);
                query.authorId = { $in: followingIds };
            }
        } 
        
        const rawIdeas = await Idea.find(query).sort({ createdAt: -1 })
            .populate('authorId', 'displayName username image')
            .populate('upvotes', '_id') 
            .populate('comments.userId', 'username'); 

        const cleanIdeas = rawIdeas.filter(idea => idea.authorId).map(idea => {
            let i = idea.toObject();
            i.upvotesCount = idea.upvotes.filter(u => u !== null).length;
            i.commentsCount = idea.comments.filter(c => c.userId !== null).length;
            return i;
        });
        
        const ideas = processIdeasData(cleanIdeas);
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

        const idea = await Idea.findById(postId)
            .populate('authorId', 'displayName username image')
            .populate({ path: 'comments.userId', select: 'displayName username image' })
            .populate({ path: 'comments.replies.userId', select: 'displayName username image' });

        if (!idea || !idea.authorId) return res.redirect('/'); 

        // Cleanup Comments
        idea.comments = idea.comments.filter(c => c.userId);
        idea.comments.forEach(c => { c.replies = c.replies.filter(r => r.userId); });

        let ideaObj = idea.toObject();

        // ✅ FIXED LOGIC: Username hamesha extract hoga
        if (idea.authorId) {
            ideaObj.authorUsername = idea.authorId.username || 'unknown'; // Username set karo
            ideaObj.authorImage = idea.authorId.image || null;            // Image set karo (null if missing)
            ideaObj.authorId = idea.authorId._id;                         // ID flatten karo
        }

        // Handle Post Images
        if (ideaObj.images && ideaObj.images.length > 0) {
            ideaObj.images = ideaObj.images.map(img => ({ src: `data:${img.type};base64,${img.content.toString('base64')}` }));
        } else { ideaObj.images = []; }

        res.render('pages/postDetail', { idea: ideaObj, user: res.locals.user });
    } catch (err) { 
        console.error("Post Detail Error:", err);
        res.redirect('/'); 
    }
};

exports.getUserProfile = async (req, res) => {
    try {
        let targetUser = await User.findById(req.params.id).populate('followers', '_id').populate('following', '_id');
        if (!targetUser) return res.redirect('/'); 

        targetUser.followers = targetUser.followers.filter(f => f !== null);
        targetUser.following = targetUser.following.filter(f => f !== null);
        await targetUser.save();

        const rawIdeas = await Idea.find({ authorId: req.params.id }).sort({ createdAt: -1 }).populate('authorId', 'username image');
        const ideas = processIdeasData(rawIdeas);
        const displayHandle = targetUser.username ? `@${targetUser.username}` : '';

        res.render('pages/userProfile', { targetUser, ideas, user: res.locals.user, pageTitle: `${targetUser.displayName} ${displayHandle}` });
    } catch (err) { res.redirect('/'); }
};

exports.getBookmarks = async (req, res) => {
    if(!req.session.userId) return res.render('pages/login', { error: "Please login to view bookmarks" });
    const user = await User.findById(req.session.userId).populate({
        path: 'bookmarks',
        populate: { path: 'authorId', select: 'displayName username image' }
    });
    const validBookmarks = (user.bookmarks || []).filter(b => b && b.authorId);
    res.render('pages/dashboard', { ideas: processIdeasData(validBookmarks), user: res.locals.user, currentCategory: 'Bookmarks', pageTitle: 'Saved' });
};

exports.getActivity = async (req, res) => {
    if(!req.session.userId) return res.render('pages/login', { error: "Please login to view activity" });
    const raw = await Idea.find({ authorId: req.session.userId }).sort({createdAt: -1}).populate('authorId', 'displayName username image');
    res.render('pages/dashboard', { ideas: processIdeasData(raw), user: res.locals.user, currentCategory: 'Activity', pageTitle: 'My Activity' });
};

exports.getAnalytics = async (req, res) => {
    if(!req.session.userId) return res.render('pages/login', { error: "Please login to view analytics" });
    const myIdeas = await Idea.find({ authorId: req.session.userId }).populate('authorId', 'displayName username image');
    const stats = { totalViews: myIdeas.reduce((a,c)=>a+c.views,0), totalUpvotes: myIdeas.reduce((a,c)=>a+c.upvotes.length,0), totalComments: myIdeas.reduce((a,c)=>a+c.comments.length,0), ideaCount: myIdeas.length };
    res.render('pages/analytics', { user: res.locals.user, stats, ideas: processIdeasData(myIdeas) });
};

exports.getConnections = async (req, res) => {
    try {
        const type = req.params.type; 
        const targetUser = await User.findById(req.params.id).populate(type, 'displayName username image bio followers');
        if (!targetUser) return res.redirect('/');
        const cleanList = targetUser[type].filter(u => u && u._id);
        res.render('pages/connections', { user: res.locals.user, targetUser, list: cleanList, type, pageTitle: `${targetUser.displayName}'s ${type}` });
    } catch (err) { res.redirect('back'); }
};

exports.getNotifications = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Please login to view notifications" });
    try {
        const user = await User.findById(req.session.userId).populate({ path: 'notifications.senders', select: 'displayName username image _id' });
        user.notifications.forEach(n => { n.senders = n.senders.filter(s => s); });
        const sortedNotifs = user.notifications.sort((a, b) => b.updatedAt - a.updatedAt);
        res.render('pages/notifications', { user: res.locals.user, notifications: sortedNotifs, pageTitle: 'Notifications' });
    } catch (err) { res.redirect('/'); }
};

// --- ACTIONS (WITH FORCED LOGIN CHECKS) ---

exports.followUser = async (req, res) => {
    // NOTE: Frontend JS handles the redirect for this specific JSON error
    if (!req.session.userId) return res.json({ error: "Login required" });
    try {
        const targetUserId = req.params.id;
        const currentUserId = req.session.userId;
        if (targetUserId === currentUserId) return res.json({ success: false });

        const currentUser = await User.findById(currentUserId);
        const targetUser = await User.findById(targetUserId);
        if(!targetUser) return res.json({ success: false });

        let isFollowing = false;
        if (currentUser.following.includes(targetUserId)) {
            currentUser.following.pull(targetUserId);
            targetUser.followers.pull(currentUserId);
        } else {
            currentUser.following.push(targetUserId);
            targetUser.followers.push(currentUserId);
            await createNotification(targetUserId, 'follow', 'started following you', `/user/${currentUserId}`, currentUserId, `@${currentUser.username}`);
            isFollowing = true;
        }
        await currentUser.save();
        await targetUser.save();
        res.json({ success: true, isFollowing, newCount: targetUser.followers.length });
    } catch (err) { res.json({ success: false }); }
};

exports.postComment = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Please login to comment" });
    try {
        const { comment } = req.body;
        const postId = req.params.id;
        const userId = req.session.userId;
        const post = await Idea.findById(postId);
        if (!post) return res.redirect('/'); 

        const newComment = { userId, user: res.locals.user.displayName, text: comment, createdAt: new Date() };
        post.comments.push(newComment);
        await post.save();

        if (post.authorId.toString() !== userId) {
            await createNotification(post.authorId, 'comment', `commented on your idea`, `/post/${postId}`, userId, `@${res.locals.user.username}`);
        }
        await handleMentions(comment, postId, userId, `@${res.locals.user.username}`);
        res.redirect(`/post/${postId}`);
    } catch (err) { res.redirect('/'); }
};

exports.replyToComment = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Please login to reply" });
    try {
        const { id, commentId } = req.params;
        const text = req.body.reply;
        const idea = await Idea.findById(id);
        const comment = idea.comments.id(commentId);
        if (comment) {
            comment.replies.push({ userId: req.session.userId, user: res.locals.user.displayName, text });
            await idea.save();
            await createNotification(comment.userId, 'reply', `replied to your comment`, `/post/${id}`, req.session.userId, `@${res.locals.user.username}`);
            await handleMentions(text, id, req.session.userId, `@${res.locals.user.username}`);
        }
        res.redirect(`/post/${id}`);
    } catch (err) { res.redirect('back'); }
};

exports.updateComment = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required" });
    try {
        const { id, commentId } = req.params;
        const { text } = req.body; 
        const post = await Idea.findById(id);
        const comment = post.comments.id(commentId);
        if (comment && comment.userId.toString() === req.session.userId) {
            comment.text = text;
            await post.save();
        }
        res.redirect(`/post/${id}`);
    } catch (err) { res.redirect(`/post/${req.params.id}`); }
};

exports.deleteComment = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required" });
    try {
        const { id, commentId } = req.params;
        const userId = req.session.userId;
        const post = await Idea.findById(id);
        const comment = post.comments.id(commentId);
        if (comment && (comment.userId.toString() === userId || post.authorId.toString() === userId)) {
            await Idea.findByIdAndUpdate(id, { $pull: { comments: { _id: commentId } } });
        }
        res.redirect(`/post/${id}`);
    } catch (err) { res.redirect(`/post/${req.params.id}`); }
};

exports.raiseIdea = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Please login to raise an idea" });
    try {
        const idea = await Idea.findById(req.params.id);
        const userId = req.session.userId;
        if (idea.upvotes.includes(userId)) { idea.upvotes.pull(userId); } 
        else { 
            idea.upvotes.push(userId);
            await createNotification(idea.authorId, 'raise', `raised your idea`, `/post/${idea._id}`, userId, `@${res.locals.user.username}`);
        }
        await idea.save();
        res.redirect(req.get('Referer') || '/');
    } catch (err) { res.redirect('/'); }
};

exports.bookmarkIdea = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Please login to bookmark" });
    const user = await User.findById(req.session.userId);
    if (user.bookmarks.includes(req.params.id)) user.bookmarks.pull(req.params.id);
    else user.bookmarks.push(req.params.id);
    await user.save();
    res.redirect(req.get('Referer') || '/');
};

exports.postIdea = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Please login to post" });
    try {
        const newIdea = new Idea({ ...req.body, author: res.locals.user.displayName, authorId: req.session.userId, images: [] });
        if (req.files) req.files.forEach(f => newIdea.images.push({ content: f.buffer, type: f.mimetype }));
        await newIdea.save();
        res.redirect('/');
    } catch (err) { res.status(500).send(err.message); }
};

exports.updatePost = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required" });
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
    if (!req.session.userId) return res.render('pages/login', { error: "Login required" });
    const idea = await Idea.findById(req.params.id);
    if (idea && idea.authorId.toString() === req.session.userId) await Idea.findByIdAndDelete(req.params.id);
    res.redirect('/'); 
};

exports.getEditPost = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required" });
    const idea = await Idea.findById(req.params.id);
    if (idea.authorId.toString() !== req.session.userId) return res.redirect('/');
    res.render('pages/editPost', { idea, user: res.locals.user });
};

exports.getSettings = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Please login to view settings" });
    let msg = null;
    if (req.query.status === 'success') msg = { type: 'success', text: 'Profile updated!' };
    if (req.query.status === 'name_error') msg = { type: 'error', text: 'Invalid Username (3-20 chars, no spaces).' };
    if (req.query.status === 'name_taken') msg = { type: 'error', text: 'Username already taken!' };
    if (req.query.status === 'pass_success') msg = { type: 'success', text: 'Password changed successfully!' };
    if (req.query.status === 'pass_error') msg = { type: 'error', text: 'Incorrect current password.' };
    res.render('pages/settings', { user: res.locals.user, message: msg });
};

exports.updateSettings = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    
    try {
        // 1. Destructure all text fields
        let { 
            displayName, 
            username, 
            bio, 
            title, 
            location, 
            skills, 
            dob, 
            phone, 
            linkedin, 
            github, 
            twitter, 
            website, 
            emailNotifs, 
            publicProfile, 
            showEmail, 
            showPhone, 
            showDob, 
            theme, 
            textSize 
        } = req.body;

        // 2. Validate & Clean Username (if provided)
        // If username is not editable in settings, remove this block or keep it for updates
        let cleanUsername = username ? username.toLowerCase().replace(/\s/g, '') : undefined;
        
        if (cleanUsername) {
            const usernameRegex = /^[\w.\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]{3,20}$/u;
            
            if (!usernameRegex.test(cleanUsername)) {
                return res.redirect('/settings?status=name_error');
            }

            // Check if username is taken by someone else
            const existing = await User.findOne({ username: cleanUsername, _id: { $ne: req.session.userId } });
            if (existing) {
                return res.redirect('/settings?status=name_taken');
            }
        }

        // 3. Prepare Skills Array
        let skillsArray = skills ? skills.split(',').map(s => s.trim()).filter(s => s.length > 0) : [];

        // 4. Construct Update Object
        const updateData = { 
            displayName,
            // Only update username if it's present and valid
            ...(cleanUsername && { username: cleanUsername }), 
            bio, 
            title, 
            location, 
            dob, 
            phone,
            skills: skillsArray,
            contacts: { linkedin, github, website, twitter },
            privacy: { 
                publicProfile: publicProfile === 'on', 
                showEmail: showEmail === 'on', 
                showPhone: showPhone === 'on', 
                showDob: showDob === 'on' 
            },
            preferences: { 
                emailNotifs: emailNotifs === 'on', 
                theme, 
                textSize 
            }
        };

        // 5. Handle File Uploads (Images)
        if (req.files) {
            // Handle Profile Image
            if (req.files['profileImage'] && req.files['profileImage'][0]) {
                const file = req.files['profileImage'][0];
                // Convert buffer to base64 string
                const base64Image = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
                updateData.image = base64Image;
            }

            // Handle Banner Image
            if (req.files['bannerImage'] && req.files['bannerImage'][0]) {
                const file = req.files['bannerImage'][0];
                // Convert buffer to base64 string
                const base64Banner = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
                updateData.bannerImage = base64Banner;
            }
        }

        // 6. Execute Update
        await User.findByIdAndUpdate(req.session.userId, { $set: updateData });
        
        res.redirect('/settings?status=success');

    } catch (err) { 
        console.error("Settings Update Error:", err);
        res.redirect('/settings?status=error'); 
    }
};

exports.changePassword = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required" });
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.session.userId);
        if (!(await bcrypt.compare(currentPassword, user.password))) return res.redirect('/settings?status=pass_error');
        user.password = await bcrypt.hash(newPassword, 12);
        await user.save();
        res.redirect('/settings?status=pass_success');
    } catch (err) { res.redirect('/settings?status=error'); }
};

exports.deleteAccount = async (req, res) => {
    if (!req.session.userId) return res.render('pages/login', { error: "Login required" });
    try {
        const userId = req.session.userId;
        await Idea.deleteMany({ authorId: userId });
        await User.updateMany({}, { $pull: { followers: userId, following: userId } });
        await User.findByIdAndDelete(userId);
        req.session.destroy(() => { res.redirect('/'); });
    } catch (err) { res.redirect('/settings'); }
}

exports.getLeaderboard = async (req, res) => {
    try {
        const leaderboard = await Idea.aggregate([
            { $group: { _id: "$authorId", totalUpvotes: { $sum: { $size: "$upvotes" } }, totalIdeas: { $sum: 1 }, authorName: { $first: "$author" } }},
            { $sort: { totalUpvotes: -1 } }, { $limit: 10 } 
        ]);
        await User.populate(leaderboard, { path: "_id", select: "displayName username image bio" });
        const cleanLeaderboard = leaderboard.filter(u => u._id);
        res.render('pages/leaderboard', { users: cleanLeaderboard, user: res.locals.user, pageTitle: 'Hall of Fame 🏆' });
    } catch (err) { res.redirect('/'); }
};

exports.getStaticPage = (req, res) => {
    const page = req.params.page; 
    const titles = { 'about': 'About Us', 'contact': 'Contact Us', 'how-to-use': 'How to Use Ideate', 'guidelines': 'Community Guidelines', 'faq': 'Frequently Asked Questions', 'terms': 'Terms & Conditions', 'privacy': 'Privacy Policy' };
    if (titles[page]) res.render(`pages/info/${page}`, { user: res.locals.user, pageTitle: titles[page] });
    else res.redirect('/');
};

exports.removeFollower = async (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    try {
        const followerId = req.params.id; const currentUserId = req.session.userId; 
        await User.findByIdAndUpdate(currentUserId, { $pull: { followers: followerId } });
        await User.findByIdAndUpdate(followerId, { $pull: { following: currentUserId } });
        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
};

exports.fixDatabase = async (req, res) => {
    try {
        const ideas = await Idea.find().populate('upvotes').populate('comments.userId');
        let fixedCount = 0;
        for (const idea of ideas) {
            let changed = false;
            const validUpvotes = idea.upvotes.filter(u => u !== null);
            if (validUpvotes.length !== idea.upvotes.length) { idea.upvotes = validUpvotes.map(u => u._id); changed = true; }
            const validComments = idea.comments.filter(c => c.userId !== null);
            if (validComments.length !== idea.comments.length) { idea.comments = validComments; changed = true; }
            if (changed) { await idea.save(); fixedCount++; }
        }
        res.send(`<div style="background:#0f172a;color:white;padding:50px;text-align:center;"><h1>✅ Cleanup Done!</h1><p>Fixed ${fixedCount} posts.</p><a href="/">Back</a></div>`);
    } catch (err) { res.send("Error: " + err.message); }
};

exports.fixUsernames = async (req, res) => {
    try {
        const users = await User.find({ username: { $exists: false } });
        let count = 0;
        let logs = "";
        for (const user of users) {
            let cleanName = user.displayName.toLowerCase().replace(/\s/g, '');
            let randomNum = Math.floor(1000 + Math.random() * 9000);
            let newUsername = `${cleanName}${randomNum}`;
            user.username = newUsername;
            await user.save();
            count++;
            logs += `<li>Fixed: <b>${user.displayName}</b> -> @${newUsername}</li>`;
        }
        res.send(`<div style="font-family: sans-serif; padding: 40px; background: #0f172a; color: white; min-height: 100vh;"><h1 style="color: #4ade80;">✅ Username Repair Complete!</h1><p>Total Users Fixed: <strong>${count}</strong></p><ul style="background: #1e293b; padding: 20px; border-radius: 10px; list-style: none;">${logs || "<li>No missing usernames found.</li>"}</ul><br><a href="/" style="background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Dashboard</a></div>`);
    } catch (err) { res.send(`<h1 style="color: red;">Error: ${err.message}</h1>`); }
};