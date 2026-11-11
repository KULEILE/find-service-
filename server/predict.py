import sys
import json
import joblib
import pandas as pd
import os

try:
    # 1. Read input from standard input (stdin)
    raw_input = sys.stdin.read()
    input_data = json.loads(raw_input)

    # 2. Build absolute path to the model
    base_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(base_dir, '..', 'fsp-ai', 'fsp_model.pkl')

    # 3. Load model
    model = joblib.load(model_path)

    # 4. Prepare dataframe
    df = pd.DataFrame([{
        'same_district': 1 if input_data['same_district'] else 0,
        'is_available': 1 if input_data['is_available'] else 0,
        'rating': float(input_data['rating']),
        'price_vs_budget': float(input_data['price_vs_budget']),
        'distance_km': float(input_data['distance_km'])
    }])

    # 5. Predict
    prediction = int(model.predict(df)[0])
    probability = float(model.predict_proba(df)[0][1] * 100)

    # 6. Output exact JSON
    print(json.dumps({
        'is_suitable': bool(prediction),
        'confidence': round(probability, 2)
    }))

except Exception as e:
    print(json.dumps({"error": str(e)}))