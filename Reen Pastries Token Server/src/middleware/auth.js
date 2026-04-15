const jwt = require('jsonwebtoken');
const { verifyFirebaseToken } = require('../config/firebase');
const { prisma } = require('../config/database');

/**
 * Middleware: verify customer Firebase ID token
 * Attaches req.user with DB user object
 */
const requireCustomerAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await verifyFirebaseToken(idToken);

    // Find or create the user in our DB
    let user = await prisma.user.findUnique({
      where: { firebaseUid: decoded.uid },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not registered' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account suspended' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/**
 * Middleware: verify owner JWT (issued by /api/owner/auth)
 * Simple JWT for the management app
 */
const requireOwnerAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Owner token required' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'owner') {
      return res.status(403).json({ success: false, message: 'Owner access only' });
    }

    req.owner = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid owner token' });
  }
};

/**
 * Middleware: verify developer JWT (issued by /api/dev/auth)
 * Protected with a separate stronger secret
 */
const requireDevAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Dev token required' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decoded = jwt.verify(token, process.env.DEV_JWT_SECRET);

    if (decoded.role !== 'developer') {
      return res.status(403).json({ success: false, message: 'Developer access only' });
    }

    req.dev = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid dev token' });
  }
};

module.exports = { requireCustomerAuth, requireOwnerAuth, requireDevAuth };
