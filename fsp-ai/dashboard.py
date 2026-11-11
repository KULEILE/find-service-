import streamlit as st
import pandas as pd
import joblib

# Load the trained model
model = joblib.load('fsp_model.pkl')

st.set_page_config(page_title="FSP AI Dashboard", layout="wide")
st.title("🤖 FSP AI Recommendation Dashboard")

st.sidebar.header("Customer Request Details")
same_district = st.sidebar.selectbox("Is provider in the same district?", ["Yes", "No"])
is_available = st.sidebar.selectbox("Is provider available?", ["Yes", "No"])
rating = st.sidebar.slider("Provider Rating", 1.0, 5.0, 4.0)
price_vs_budget = st.sidebar.slider("Price vs Budget (0.8 = 20% cheaper)", 0.5, 1.5, 1.0)
distance_km = st.sidebar.slider("Distance (km)", 0.0, 50.0, 10.0)

input_data = pd.DataFrame({
    'same_district': [1 if same_district == "Yes" else 0],
    'is_available': [1 if is_available == "Yes" else 0],
    'rating': [rating],
    'price_vs_budget': [price_vs_budget],
    'distance_km': [distance_km]
})

prediction = model.predict(input_data)[0]
probability = model.predict_proba(input_data)[0][1] * 100

st.subheader("AI Recommendation Result")
if prediction == 1:
    st.success(f"✅ Suitable Match (Confidence: {probability:.1f}%)")
else:
    st.error(f"❌ Not a Suitable Match (Confidence: {100 - probability:.1f}%)")

st.markdown("---")
st.subheader("Feature Importance")
features = ['same_district', 'is_available', 'rating', 'price_vs_budget', 'distance_km']
importances = model.feature_importances_
st.bar_chart(dict(zip(features, importances)))