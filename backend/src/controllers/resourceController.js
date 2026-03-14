const Resource = require('../models/Resource');

// @desc    Get public/aggregated resources (e.g., for a shelter view)
// @route   GET /api/resources/public
// @access  Private
const getPublicResources = async (req, res) => {
  try {
    const resources = await Resource.find({ isPublic: true })
      .populate('ownerId', 'name zone')
      .sort({ createdAt: -1 });
    res.json(resources);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user's personal resources
// @route   GET /api/resources/me
// @access  Private
const getMyResources = async (req, res) => {
  try {
    const resources = await Resource.find({ ownerId: req.user._id })
      .sort({ createdAt: -1 });
    res.json(resources);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Add or Update a resource payload
// @route   POST /api/resources
// @access  Private
const addResource = async (req, res) => {
  try {
    const { type, quantity, unit, status, isPublic, location } = req.body;

    // Optional: check if the resource already exists for this user and type
    let existingResource = await Resource.findOne({ ownerId: req.user._id, type });
    
    if (existingResource) {
      existingResource.quantity = quantity !== undefined ? quantity : existingResource.quantity;
      existingResource.unit = unit || existingResource.unit;
      existingResource.status = status || existingResource.status;
      existingResource.isPublic = isPublic !== undefined ? isPublic : existingResource.isPublic;
      if (location) existingResource.location = location;

      const updated = await existingResource.save();
      return res.json(updated);
    }

    const resource = await Resource.create({
      ownerId: req.user._id,
      type,
      quantity,
      unit,
      status,
      isPublic,
      location
    });

    res.status(201).json(resource);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getPublicResources,
  getMyResources,
  addResource
};
