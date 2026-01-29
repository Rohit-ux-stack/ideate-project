const Idea = require('../models/Idea');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// --- HELPER: Process Images & Attach Author Image ---
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

        // 2. Extract Author Image safely
        if (i.authorId && i.authorId.image) {
            i.authorImage = i.authorId.image;
            i.authorId = i.authorId._id;
        } else if (i.authorId && i.authorId._id) {
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
        const targetUser = await User.findOne({ displayName: username });
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
        if (req.query.find) {
            const targetUser = await User.findOne({ displayName: req.query.find });
            if (targetUser) return res.redirect(`/user/${targetUser._id}`);
            return res.redirect(req.get('Referer') || '/');
        }
        const search = req.query.q;
        if (!search) return res.json([]);
        const users = await User.find({ displayName: { $regex: search, $options: 'i' } }).select('displayName _id image').limit(5);
        res.json(users);
    } catch (err) { 
        if (req.query.find) return res.redirect('/');
        res.json([]); 
    }
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
        
        const rawIdeas = await Idea.find(query).sort({ createdAt: -1 }).populate('authorId', 'displayName image');
        
        // Filter out ideas where author doesn't exist anymore (Cleanup)
        const validIdeas = rawIdeas.filter(idea => idea.authorId);
        
        const ideas = processIdeasData(validIdeas);
        
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
            .populate('authorId', 'displayName image')
            .populate({ path: 'comments.userId', select: 'displayName image' })
            .populate({ path: 'comments.replies.userId', select: 'displayName image' });

        if (!idea) return res.status(404).send("Not Found");
        
        // --- CLEANUP LOGIC: Post Author Deleted? ---
        if (!idea.authorId) return res.redirect('/'); 

        // --- CLEANUP LOGIC: Filter Comments & Replies ---
        // Agar comment karne wala user null hai (deleted), toh comment hata do
        idea.comments = idea.comments.filter(c => c.userId);

        // Har comment ke andar replies bhi check karo
        idea.comments.forEach(c => {
            c.replies = c.replies.filter(r => r.userId);
        });

        let ideaObj = idea.toObject();
        
        // PFP Logic
        if(idea.authorId && idea.authorId.image) {
            ideaObj.authorImage = idea.authorId.image;
            ideaObj.authorId = idea.authorId._id;
        }

        if (ideaObj.images && ideaObj.images.length > 0) {
            ideaObj.images = ideaObj.images.map(img => ({ src: `data:${img.type};base64,${img.content.toString('base64')}` }));
        } else { ideaObj.images = []; }

        res.render('pages/postDetail', { idea: ideaObj, user: res.locals.user });
    } catch (err) { res.redirect('/'); }
};

exports.getUserProfile = async (req, res) => {
    try {
        // 1. User ko dhoondo aur Followers/Following ko populate karo
        let targetUser = await User.findById(req.params.id)
            .populate('followers', '_id') // Sirf ID check karenge existence ke liye
            .populate('following', '_id');

        if (!targetUser) return res.redirect('/'); 

        // 2. --- SELF HEALING LOGIC START ---
        // Hum check karenge ki populate hone ke baad kitne NULL mile (matlab deleted users)
        
        const validFollowers = targetUser.followers.filter(f => f !== null);
        const validFollowing = targetUser.following.filter(f => f !== null);

        // Agar kachra mila (Counts match nahi kar rahe), toh Database update karo
        if (validFollowers.length !== targetUser.followers.length || validFollowing.length !== targetUser.following.length) {
            targetUser.followers = validFollowers;
            targetUser.following = validFollowing;
            await targetUser.save(); // ✨ Jadoo: Invalid IDs database se hamesha ke liye gayab!
            console.log("System cleaned up deleted users from profile.");
        }
        // 3. --- SELF HEALING LOGIC END ---

        // Ab Ideas fetch karo
        const rawIdeas = await Idea.find({ authorId: req.params.id })
            .sort({ createdAt: -1 })
            .populate('authorId', 'image');

        const ideas = processIdeasData(rawIdeas);

        res.render('pages/userProfile', { 
            targetUser, // Ab ye clean user object jayega
            ideas, 
            user: res.locals.user, 
            pageTitle: `${targetUser.displayName}'s Profile` 
        });

    } catch (err) { 
        console.error(err);
        res.redirect('/'); 
    }
};

exports.getBookmarks = async (req, res) => {
    if(!req.session.userId) return res.redirect('/login');
    const user = await User.findById(req.session.userId).populate({
            path: 'bookmarks',
            populate: { path: 'authorId', select: 'displayName image' }
        });
        
    // Clean deleted ideas
    const validBookmarks = (user.bookmarks || []).filter(b => b.authorId);
    
    res.render('pages/dashboard', { ideas: processIdeasData(validBookmarks), user: res.locals.user, currentCategory: 'Bookmarks', pageTitle: 'Saved' });
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

// --- CONNECTIONS (CLEANUP ADDED) ---
exports.getConnections = async (req, res) => {
    try {
        const type = req.params.type; 
        const targetUser = await User.findById(req.params.id).populate(type, 'displayName image bio followers');
        if (!targetUser) return res.redirect('/');
        
        // CLEANUP: Filter out null users (deleted accounts)
        const cleanList = targetUser[type].filter(u => u && u._id);

        res.render('pages/connections', { user: res.locals.user, targetUser, list: cleanList, type, pageTitle: `${targetUser.displayName}'s ${type}` });
    } catch (err) { res.redirect('back'); }
};

exports.getNotifications = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId).populate({ path: 'notifications.senders', select: 'displayName image _id' });
        
        // Cleanup Senders in Notifications if user deleted
        user.notifications.forEach(n => {
            n.senders = n.senders.filter(s => s); // Remove null senders
        });

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
        if(!targetUser) return res.json({ success: false }); // User not found

        let isFollowing = false;
        if (currentUser.following.includes(targetUserId)) {
            currentUser.following.pull(targetUserId);
            targetUser.followers.pull(currentUserId);
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
        const { 
            displayName, bio, title, location, skills, dob, phone, // Personal Info
            linkedin, github, twitter, website, // Socials
            emailNotifs, publicProfile, showEmail, showPhone, showDob, // Privacy Toggles
            theme, textSize // Appearance
        } = req.body;

        // Skills Logic
        let skillsArray = [];
        if (skills) {
            skillsArray = skills.split(',').map(s => s.trim()).filter(s => s.length > 0);
        }

        const updateData = { 
            displayName, bio, title, location, dob, phone,
            skills: skillsArray,
            contacts: { linkedin, github, website, twitter },
            
            // Privacy Object Update
            privacy: {
                publicProfile: publicProfile === 'on',
                showEmail: showEmail === 'on',
                showPhone: showPhone === 'on',
                showDob: showDob === 'on'
            },

            // Preferences Object Update
            preferences: {
                emailNotifs: emailNotifs === 'on',
                theme: theme,
                textSize: textSize
            }
        };

        if (req.file) {
            updateData.imageContent = req.file.buffer;
            updateData.imageType = req.file.mimetype;
            updateData.image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
        }

        await User.findByIdAndUpdate(req.session.userId, { $set: updateData });
        res.redirect('/settings?status=success');
    } catch (err) { 
        console.error(err);
        res.redirect('/settings?status=error'); 
    }
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

// --- DELETE ACCOUNT (COMPLETE CLEANUP) ---
exports.deleteAccount = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const userId = req.session.userId;
        
        // 1. Delete all ideas by this user
        await Idea.deleteMany({ authorId: userId });
        
        // 2. Remove user from everyone's Following & Followers lists
        await User.updateMany({}, { $pull: { followers: userId, following: userId } });
        
        // 3. Delete the user
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

// --- LEADERBOARD & STATIC PAGES ---

// 1. Get Hall of Fame
exports.getLeaderboard = async (req, res) => {
    try {
        const leaderboard = await Idea.aggregate([
            { $group: { 
                _id: "$authorId", 
                totalUpvotes: { $sum: { $size: "$upvotes" } },
                totalIdeas: { $sum: 1 },
                authorName: { $first: "$author" }
            }},
            { $sort: { totalUpvotes: -1 } }, 
            { $limit: 10 } 
        ]);

        await User.populate(leaderboard, { path: "_id", select: "displayName image bio" });
        
        // CLEANUP: Filter out null users (deleted accounts)
        const cleanLeaderboard = leaderboard.filter(u => u._id);

        res.render('pages/leaderboard', { 
            users: cleanLeaderboard, 
            user: res.locals.user, 
            pageTitle: 'Hall of Fame 🏆' 
        });
    } catch (err) { console.error(err); res.redirect('/'); }
};

// 2. Smart Static Page Handler
exports.getStaticPage = (req, res) => {
    const page = req.params.page; 
    const titles = {
        'about': 'About Us',
        'contact': 'Contact Us',
        'how-to-use': 'How to Use Ideate',
        'guidelines': 'Community Guidelines',
        'faq': 'Frequently Asked Questions',
        'terms': 'Terms & Conditions',
        'privacy': 'Privacy Policy'
    };

    if (titles[page]) {
        res.render(`pages/info/${page}`, { 
            user: res.locals.user, 
            pageTitle: titles[page] 
        });
    } else {
        res.redirect('/');
    }
};
// --- REMOVE FOLLOWER ---
exports.removeFollower = async (req, res) => {
    if (!req.session.userId) return res.json({ success: false });
    try {
        const followerId = req.params.id; // Jisko hatana hai
        const currentUserId = req.session.userId; // Main khud

        // 1. Meri 'followers' list se usko hatao
        await User.findByIdAndUpdate(currentUserId, { $pull: { followers: followerId } });

        // 2. Uske 'following' list se mujhe hatao
        await User.findByIdAndUpdate(followerId, { $pull: { following: currentUserId } });

        res.json({ success: true });
    } catch (err) { res.json({ success: false }); }
};
exports.updateSettings = async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');
    try {
        const { 
            displayName, bio, title, location, skills, dob, phone,
            linkedin, github, twitter, website, // ✅ Social inputs
            emailNotifs, publicProfile, 
            showEmail, showPhone, showDob, // ✅ Visibility Toggles
            theme, textSize
        } = req.body;

        let skillsArray = [];
        if (skills) skillsArray = skills.split(',').map(s => s.trim()).filter(s => s.length > 0);

        const updateData = { 
            displayName, bio, title, location, dob, phone,
            skills: skillsArray,
            // ✅ Fix: Save Contacts Correctly
            contacts: { linkedin, github, website, twitter },
            // ✅ Fix: Save Privacy Toggles (Checkboxes send 'on' or undefined)
            privacy: {
                publicProfile: publicProfile === 'on',
                showEmail: showEmail === 'on',
                showPhone: showPhone === 'on',
                showDob: showDob === 'on'
            },
            preferences: {
                emailNotifs: emailNotifs === 'on',
                theme: theme,
                textSize: textSize
            }
        };

        // Handle Images (Profile & Banner)
        if (req.files) {
            if (req.files['profileImage']) {
                const file = req.files['profileImage'][0];
                updateData.imageContent = file.buffer;
                updateData.imageType = file.mimetype;
                updateData.image = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
            }
            if (req.files['bannerImage']) {
                const file = req.files['bannerImage'][0];
                updateData.bannerImage = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
            }
        }

        await User.findByIdAndUpdate(req.session.userId, { $set: updateData });
        res.redirect('/settings?status=success');
    } catch (err) { 
        console.error(err);
        res.redirect('/settings?status=error'); 
    }
};