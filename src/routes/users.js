const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Login route
router.post('/login', async (req, res, next) => {
  try {
    const schema = z.object({
      username: z.string().trim().min(1).max(50),
      password: z.string().min(6)
    });

    const input = schema.parse(req.body);

    const user = await User.findOne({ username: input.username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(input.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin
      }
    });
  } catch (err) {
    next(err);
  }
});

// Create user (protected route)
router.post('/', auth, async (req, res, next) => {
  try {
    const schema = z.object({
      username: z.string().trim().min(3).max(50),
      password: z.string().min(6),
      isAdmin: z.boolean().optional().default(false)
    });

    const input = schema.parse(req.body);

    const existingUser = await User.findOne({ username: input.username });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const user = await User.create({
      username: input.username,
      password: input.password,
      isAdmin: input.isAdmin
    });

    res.status(201).json({
      user: {
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin
      }
    });
  } catch (err) {
    next(err);
  }
});

// List users (protected route)
router.get('/', auth, async (req, res, next) => {
  try {
    const querySchema = z.object({
      search: z.string().trim().optional(),
      page: z.string().optional(),
      pageSize: z.string().optional()
    });
    const q = querySchema.parse(req.query);

    const filter = {};
    if (q.search) {
      const re = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.username = re;
    }

    const page = q.page ? Number(q.page) : 1;
    const pageSize = q.pageSize ? Number(q.pageSize) : 10;
    const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
    const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(200, Math.floor(pageSize)) : 10;
    const skip = (safePage - 1) * safePageSize;

    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .sort({ username: 1 })
      .skip(skip)
      .limit(safePageSize)
      .select('username isAdmin createdAt');

    res.json({
      users: users.map(u => ({
        id: u._id,
        username: u.username,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt
      })),
      page: safePage,
      pageSize: safePageSize,
      total
    });
  } catch (err) {
    next(err);
  }
});

// Update user (protected route)
router.patch('/:id', auth, async (req, res, next) => {
  try {
    const schema = z.object({
      isAdmin: z.boolean().optional(),
      password: z.string().min(6).optional()
    });
    const input = schema.parse(req.body);

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (input.isAdmin !== undefined && input.isAdmin !== user.isAdmin && !input.isAdmin) {
      const adminCount = await User.countDocuments({ isAdmin: true });
      if (adminCount <= 1) {
        return res.status(409).json({ error: 'Cannot remove admin — at least one administrator is required' });
      }
    }

    if (input.isAdmin !== undefined) user.isAdmin = input.isAdmin;
    if (input.password !== undefined) user.password = input.password;
    await user.save();

    res.json({
      user: {
        id: user._id,
        username: user.username,
        isAdmin: user.isAdmin
      }
    });
  } catch (err) {
    next(err);
  }
});

// Delete user (protected route)
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (String(user._id) === String(req.user._id)) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    if (user.isAdmin) {
      const adminCount = await User.countDocuments({ isAdmin: true });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last remaining administrator' });
      }
    }

    await User.findByIdAndDelete(user._id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
