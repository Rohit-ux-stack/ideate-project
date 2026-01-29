const nodemailer = require('nodemailer');

const sendEmail = async (email, subject, text) => {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail', // ✅ Change 1: Host hata kar 'service: gmail' lagaya
            auth: {
                user: 'rohitbanerjee847@gmail.com', // ✅ Aapka Gmail
                pass: 'preh gmgn bwjb qtbj'          // ✅ Aapka App Password
            }
        });

        // Email bhejo
        await transporter.sendMail({
            from: '"Ideate Team" <rohitbanerjee847@gmail.com>', // ✅ From address must match authenticated user
            to: email, 
            subject: subject,
            text: text, 
            html: `<div style="font-family: sans-serif; padding: 20px; background: #f3f4f6;">
                    <div style="max-w-md mx-auto bg-white p-6 rounded-lg shadow-md;">
                        <h2 style="color: #2563EB;">Verify Your Account</h2>
                        <p>Welcome to Ideate! Use the code below to verify your email.</p>
                        <h1 style="background: #e0e7ff; color: #1e40af; padding: 10px; text-align: center; letter-spacing: 5px; border-radius: 8px;">${text}</h1>
                        <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">This code expires in 10 minutes.</p>
                    </div>
                   </div>`
        });

        console.log("✅ Email sent successfully to:", email);
        
        // ❌ Note: Real Gmail mein "Preview URL" nahi hota, isliye wo line hata di.
        
    } catch (error) {
        console.log("❌ Email not sent:", error);
    }
};

module.exports = sendEmail;