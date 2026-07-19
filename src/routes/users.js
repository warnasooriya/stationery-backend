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

module.exports = router;
