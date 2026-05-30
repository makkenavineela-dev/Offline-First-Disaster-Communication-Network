'use strict';

const Resource = require('../models/Resource');

const VALID_TYPES = ['medical', 'water', 'food', 'power', 'shelter', 'equipment', 'communication', 'other'];

// @desc    List all public resources (everyone's)
// @route   GET /api/resources/
// @access  Private
const getAllResources = async (req, res) => {
  try {
    const resources = await Resource.find({ isPublic: true })
      .populate('ownerId', 'name zone phone')
      .sort({ createdAt: -1 });
    res.json(resources);
  } catch (_) {
    res.status(500).json({ message: 'Failed to retrieve resources' });
  }
};

// @desc    List only the current user's resources
// @route   GET /api/resources/me
// @access  Private
const getMyResources = async (req, res) => {
  try {
    const resources = await Resource.find({ ownerId: req.user._id })
      .sort({ createdAt: -1 });
    res.json(resources);
  } catch (_) {
    res.status(500).json({ message: 'Failed to retrieve your resources' });
  }
};

// @desc    Add a new resource
// @route   POST /api/resources/
// @access  Private (any authenticated user)
const addResource = async (req, res) => {
  try {
    const { name, type, quantity, unit, status, isPublic, location } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Resource name is required' });
    }
    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const resource = await Resource.create({
      ownerId:  req.user._id,
      name:     name.trim(),
      type,
      quantity: quantity !== undefined ? Number(quantity) : 0,
      unit:     unit || 'units',
      status:   status || 'OK',
      isPublic: isPublic !== false,      // default true
      location: location || undefined,
    });

    res.status(201).json(resource);
  } catch (_) {
    res.status(500).json({ message: 'Failed to add resource' });
  }
};

// @desc    Update a resource (owner only)
// @route   PUT /api/resources/:id
// @access  Private
const updateResource = async (req, res) => {
  try {
    const resource = await Resource.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found or not yours to edit' });
    }

    const { name, type, quantity, unit, status, isPublic, location } = req.body;
    if (name      !== undefined) resource.name     = name.trim();
    if (type      !== undefined) {
      if (!VALID_TYPES.includes(type)) return res.status(400).json({ message: 'Invalid type' });
      resource.type = type;
    }
    if (quantity  !== undefined) resource.quantity = Number(quantity);
    if (unit      !== undefined) resource.unit     = unit;
    if (status    !== undefined) resource.status   = status;
    if (isPublic  !== undefined) resource.isPublic = isPublic;
    if (location  !== undefined) resource.location = location;

    const updated = await resource.save();
    res.json(updated);
  } catch (_) {
    res.status(500).json({ message: 'Failed to update resource' });
  }
};

// @desc    Delete a resource (owner only)
// @route   DELETE /api/resources/:id
// @access  Private
const deleteResource = async (req, res) => {
  try {
    const resource = await Resource.findOneAndDelete({ _id: req.params.id, ownerId: req.user._id });
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found or not yours to delete' });
    }
    res.json({ message: 'Deleted', id: req.params.id });
  } catch (_) {
    res.status(500).json({ message: 'Failed to delete resource' });
  }
};

module.exports = { getAllResources, getMyResources, addResource, updateResource, deleteResource };
