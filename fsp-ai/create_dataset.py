import pandas as pd
import numpy as np

# Set a random seed for reproducibility
np.random.seed(42)

# Generate 1000 synthetic provider matches
n_samples = 1000

data = {
    # 1 if same district, 0 if different
    'same_district': np.random.choice([0, 1], n_samples, p=[0.3, 0.7]), 
    # 1 if provider is available, 0 if not
    'is_available': np.random.choice([0, 1], n_samples, p=[0.2, 0.8]),
    # Provider rating (1.0 to 5.0)
    'rating': np.random.uniform(1.0, 5.0, n_samples).round(1),
    # Price relative to customer budget (0.5 means very cheap, 1.5 means over budget)
    'price_vs_budget': np.random.uniform(0.5, 1.5, n_samples).round(2),
    # Distance in km
    'distance_km': np.random.uniform(0, 50, n_samples).round(1)
}

df = pd.DataFrame(data)

# Create the target variable (Suitable Match: 1 or 0) based on business logic
def calculate_suitability(row):
    score = 0
    if row['is_available'] == 1: score += 2
    if row['same_district'] == 1: score += 2
    if row['price_vs_budget'] <= 1.0: score += 2
    if row['rating'] >= 3.5: score += 2
    if row['distance_km'] <= 15: score += 2
    
    # If the score is high enough, it's a suitable match
    return 1 if score >= 6 else 0

df['suitable_match'] = df.apply(calculate_suitability, axis=1)

# Save the dataset
df.to_csv('fsp_dataset.csv', index=False)
print("✅ Dataset created successfully and saved as fsp_dataset.csv")
print(df.head())