require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fileUpload = require('express-fileupload');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    useTempFiles: true,
    tempFileDir: '/tmp/'
}));
app.use(express.static('public'));

// Initialize Firebase Admin
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
initializeApp({
    credential: cert(firebaseConfig)
});
const db = getFirestore();

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// JWT Authentication Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// ============================================================
// AUTH ROUTES
// ============================================================

app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
            const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '24h' });
            res.json({ success: true, token });
        } else {
            res.status(401).json({ error: 'Invalid username or password' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ success: true, user: req.user });
});

// ============================================================
// PRODUCTS ROUTES
// ============================================================

app.get('/api/products', async (req, res) => {
    try {
        const snapshot = await db.collection('products').get();
        const products = [];
        snapshot.forEach(doc => {
            products.push({ id: doc.id, ...doc.data() });
        });
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/products', authenticateToken, async (req, res) => {
    try {
        const { name, description, price } = req.body;
        
        if (!name || !description || !price) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        let imageUrl = '';
        if (req.files && req.files.image) {
            const result = await cloudinary.uploader.upload(req.files.image.tempFilePath, {
                folder: 'house-system/products'
            });
            imageUrl = result.secure_url;
        }
        
        const product = {
            name,
            description,
            price: parseFloat(price),
            imageUrl,
            createdAt: FieldValue.serverTimestamp()
        };
        
        const docRef = await db.collection('products').add(product);
        res.json({ success: true, id: docRef.id, ...product });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, price } = req.body;
        
        const productRef = db.collection('products').doc(id);
        const productDoc = await productRef.get();
        
        if (!productDoc.exists) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        let updateData = {
            name,
            description,
            price: parseFloat(price)
        };
        
        if (req.files && req.files.image) {
            const result = await cloudinary.uploader.upload(req.files.image.tempFilePath, {
                folder: 'house-system/products'
            });
            updateData.imageUrl = result.secure_url;
        }
        
        await productRef.update(updateData);
        res.json({ success: true, id, ...updateData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('products').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// WIFI CODES ROUTES
// ============================================================

app.get('/api/wifi-codes', authenticateToken, async (req, res) => {
    try {
        const snapshot = await db.collection('wifiCodes').get();
        const codes = [];
        snapshot.forEach(doc => {
            codes.push({ id: doc.id, ...doc.data() });
        });
        res.json(codes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/wifi-codes', authenticateToken, async (req, res) => {
    try {
        const { code } = req.body;
        
        if (!code || code.length !== 16 || !/^\d+$/.test(code)) {
            return res.status(400).json({ error: 'Code must be 16 digits' });
        }
        
        const wifiCode = {
            code,
            isUsed: false,
            isActive: true,
            createdAt: FieldValue.serverTimestamp()
        };
        
        const docRef = await db.collection('wifiCodes').add(wifiCode);
        res.json({ success: true, id: docRef.id, ...wifiCode });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/wifi-codes/:id/toggle', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        
        await db.collection('wifiCodes').doc(id).update({ isActive });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/wifi-codes/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('wifiCodes').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// WIFI SESSIONS ROUTES
// ============================================================

app.post('/api/wifi-sessions', async (req, res) => {
    try {
        const { phoneNumber, code } = req.body;
        
        if (!phoneNumber || !code) {
            return res.status(400).json({ error: 'Phone number and code are required' });
        }
        
        // Find the code in Firestore
        const codeSnapshot = await db.collection('wifiCodes')
            .where('code', '==', code)
            .where('isUsed', '==', false)
            .where('isActive', '==', true)
            .get();
        
        if (codeSnapshot.empty) {
            return res.status(400).json({ error: 'Invalid or already used code' });
        }
        
        const codeDoc = codeSnapshot.docs[0];
        const codeData = codeDoc.data();
        
        // Mark code as used
        await codeDoc.ref.update({ isUsed: true, usedAt: FieldValue.serverTimestamp() });
        
        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + 20 * 60000); // 20 minutes
        
        const session = {
            phoneNumber,
            code,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            status: 'active',
            price: 20,
            createdAt: FieldValue.serverTimestamp()
        };
        
        const docRef = await db.collection('wifiSessions').add(session);
        
        // Return WiFi credentials
        res.json({
            success: true,
            id: docRef.id,
            ...session,
            wifiSSID: process.env.WIFI_SSID,
            wifiPassword: process.env.WIFI_PASSWORD,
            wifiSecurity: process.env.WIFI_SECURITY || 'WPA2'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/wifi-sessions', authenticateToken, async (req, res) => {
    try {
        const snapshot = await db.collection('wifiSessions').orderBy('createdAt', 'desc').get();
        const sessions = [];
        snapshot.forEach(doc => {
            sessions.push({ id: doc.id, ...doc.data() });
        });
        
        // Calculate remaining time for each session
        const now = new Date();
        sessions.forEach(session => {
            if (session.status === 'active') {
                const endTime = new Date(session.endTime);
                const remainingMs = endTime - now;
                if (remainingMs <= 0) {
                    session.status = 'expired';
                    // Update in Firestore
                    db.collection('wifiSessions').doc(session.id).update({ status: 'expired' });
                } else {
                    session.remainingTime = Math.ceil(remainingMs / 60000); // in minutes
                }
            }
        });
        
        res.json(sessions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// FEEDBACK ROUTES
// ============================================================

app.get('/api/feedback', async (req, res) => {
    try {
        const snapshot = await db.collection('feedback').orderBy('createdAt', 'desc').get();
        const feedbacks = [];
        snapshot.forEach(doc => {
            feedbacks.push({ id: doc.id, ...doc.data() });
        });
        
        // Calculate average rating
        let totalRating = 0;
        feedbacks.forEach(f => { totalRating += f.rating || 0; });
        const averageRating = feedbacks.length > 0 ? (totalRating / feedbacks.length) : 0;
        
        res.json({
            feedbacks,
            averageRating,
            totalReviews: feedbacks.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/feedback', async (req, res) => {
    try {
        const { name, rating, comment } = req.body;
        
        if (!name || !rating || !comment) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        const feedback = {
            name,
            rating: parseFloat(rating),
            comment,
            createdAt: FieldValue.serverTimestamp()
        };
        
        const docRef = await db.collection('feedback').add(feedback);
        res.json({ success: true, id: docRef.id, ...feedback });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/feedback/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('feedback').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// ORDERS ROUTES
// ============================================================

app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const snapshot = await db.collection('orders').orderBy('createdAt', 'desc').get();
        const orders = [];
        snapshot.forEach(doc => {
            orders.push({ id: doc.id, ...doc.data() });
        });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { items, total, hasInternet, customerName, phoneNumber } = req.body;
        
        if (!items || !total) {
            return res.status(400).json({ error: 'Items and total are required' });
        }
        
        const order = {
            items,
            total: parseFloat(total),
            hasInternet: hasInternet || false,
            customerName: customerName || 'Guest',
            phoneNumber: phoneNumber || '',
            status: 'pending',
            createdAt: FieldValue.serverTimestamp()
        };
        
        const docRef = await db.collection('orders').add(order);
        res.json({ success: true, id: docRef.id, ...order });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/orders/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const validStatuses = ['pending', 'preparing', 'ready', 'delivered', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        await db.collection('orders').doc(id).update({ status });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// PAYMENTS ROUTES
// ============================================================

app.post('/api/payments', async (req, res) => {
    try {
        const { orderId, total, items, hasInternet } = req.body;
        
        if (!orderId || !total) {
            return res.status(400).json({ error: 'Order ID and total are required' });
        }
        
        let screenshotUrl = '';
        if (req.files && req.files.screenshot) {
            const result = await cloudinary.uploader.upload(req.files.screenshot.tempFilePath, {
                folder: 'house-system/payments'
            });
            screenshotUrl = result.secure_url;
        }
        
        const payment = {
            orderId,
            total: parseFloat(total),
            items: items || [],
            hasInternet: hasInternet || false,
            screenshotUrl,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp()
        };
        
        const docRef = await db.collection('payments').add(payment);
        res.json({ success: true, id: docRef.id, ...payment });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/payments', authenticateToken, async (req, res) => {
    try {
        const snapshot = await db.collection('payments').orderBy('createdAt', 'desc').get();
        const payments = [];
        snapshot.forEach(doc => {
            payments.push({ id: doc.id, ...doc.data() });
        });
        res.json(payments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/payments/:id/status', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const validStatuses = ['pending', 'accepted', 'rejected'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        await db.collection('payments').doc(id).update({ status });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/payments/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('payments').doc(id).delete();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// DASHBOARD STATISTICS ROUTES
// ============================================================

app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    try {
        // Get products count
        const productsSnapshot = await db.collection('products').get();
        const productsCount = productsSnapshot.size;
        
        // Get orders count
        const ordersSnapshot = await db.collection('orders').get();
        const ordersCount = ordersSnapshot.size;
        
        // Get payments count
        const paymentsSnapshot = await db.collection('payments').get();
        const paymentsCount = paymentsSnapshot.size;
        
        // Get wifi sessions count
        const wifiSessionsSnapshot = await db.collection('wifiSessions').get();
        const wifiSessionsCount = wifiSessionsSnapshot.size;
        
        // Get wifi codes count
        const wifiCodesSnapshot = await db.collection('wifiCodes').get();
        const wifiCodesCount = wifiCodesSnapshot.size;
        
        // Get used wifi codes
        const usedCodesSnapshot = await db.collection('wifiCodes').where('isUsed', '==', true).get();
        const usedCodesCount = usedCodesSnapshot.size;
        
        // Get remaining wifi codes
        const remainingCodesCount = wifiCodesCount - usedCodesCount;
        
        // Calculate internet profits (20 EGP per session)
        const internetProfit = wifiSessionsCount * 20;
        
        // Calculate total sales from orders
        let totalSales = 0;
        const ordersList = [];
        ordersSnapshot.forEach(doc => {
            const order = doc.data();
            ordersList.push(order);
            totalSales += order.total || 0;
        });
        
        // Get average rating from feedback
        const feedbackSnapshot = await db.collection('feedback').get();
        let totalRating = 0;
        feedbackSnapshot.forEach(doc => {
            const feedback = doc.data();
            totalRating += feedback.rating || 0;
        });
        const averageRating = feedbackSnapshot.size > 0 ? (totalRating / feedbackSnapshot.size) : 0;
        
        res.json({
            productsCount,
            ordersCount,
            paymentsCount,
            wifiSessionsCount,
            wifiCodesCount,
            usedCodesCount,
            remainingCodesCount,
            internetProfit,
            totalSales,
            averageRating: parseFloat(averageRating.toFixed(2)),
            totalReviews: feedbackSnapshot.size
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// UPLOAD ROUTE
// ============================================================

app.post('/api/upload', authenticateToken, async (req, res) => {
    try {
        if (!req.files || !req.files.image) {
            return res.status(400).json({ error: 'No image uploaded' });
        }
        
        const result = await cloudinary.uploader.upload(req.files.image.tempFilePath, {
            folder: 'house-system/uploads'
        });
        
        res.json({ success: true, url: result.secure_url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// PUBLIC ROUTES FOR WIFI INFO (no auth required)
// ============================================================

app.get('/api/wifi-info', (req, res) => {
    res.json({
        ssid: process.env.WIFI_SSID,
        security: process.env.WIFI_SECURITY || 'WPA2'
    });
});

// ============================================================
// SERVE HTML FILES
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/pay', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pay.html'));
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});