const express = require('express');
const { PythonShell } = require('python-shell');
const path = require('path');
const { z } = require('zod');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

const predictSchema = z.object({
  same_district: z.boolean(),
  is_available: z.boolean(),
  rating: z.coerce.number(),
  price_vs_budget: z.coerce.number(),
  distance_km: z.coerce.number()
});

router.post('/predict', asyncHandler(async (req, res) => {
  const body = predictSchema.parse(req.body);
  
  const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
  
  const options = {
    mode: 'text',
    pythonPath: pythonCmd,
    scriptPath: path.join(__dirname, '../../')
    // NO ARGS - we use stdin
  };

  console.log('🐍 Running Python with:', pythonCmd);

  const pyshell = new PythonShell('predict.py', options);

  // Send JSON via stdin
  pyshell.send(JSON.stringify(body));

  let output = '';
  pyshell.on('message', function (message) {
    output += message;
  });

  pyshell.end(function (err) {
    if (err) {
      console.error('❌ PYTHON ERROR:', err);
      return res.status(500).json({ error: 'AI service failed', details: err.message });
    }

    try {
      const result = JSON.parse(output);
      if (result.error) throw new Error(result.error);
      res.json(result);
    } catch (e) {
      console.error('❌ PARSE ERROR:', e.message, 'Raw:', output);
      res.status(500).json({ error: 'Failed to parse AI response', raw: output });
    }
  });
}));

module.exports = router;