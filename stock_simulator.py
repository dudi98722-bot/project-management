import streamlit as st
import yfinance as yf
import pandas as pd
import plotly.graph_objects as go
from datetime import date, timedelta

st.set_page_config(page_title="סימולטור מניות", layout="wide", page_icon="📈")

st.markdown("""
<style>
    body { direction: rtl; }
    .stApp { font-family: 'Segoe UI', Arial, sans-serif; }
    .metric-card {
        background: linear-gradient(135deg, #1e3a5f, #2d6a9f);
        border-radius: 12px;
        padding: 20px;
        text-align: center;
        color: white;
        margin: 5px;
    }
    .profit { color: #00e676; font-size: 2rem; font-weight: bold; }
    .loss   { color: #ff5252; font-size: 2rem; font-weight: bold; }
</style>
""", unsafe_allow_html=True)

st.title("📈 סימולטור אסטרטגיית מסחר במניות")
st.markdown("---")

# ── Sidebar inputs ──────────────────────────────────────────────────────────
with st.sidebar:
    st.header("⚙️ הגדרות סימולציה")

    ticker = st.text_input("טיקר מניה (לדוגמה: AMZN, AAPL, TSLA)", value="AMZN").upper().strip()

    col1, col2 = st.columns(2)
    with col1:
        start_date = st.date_input("תאריך התחלה", value=date(2020, 1, 1), min_value=date(2000, 1, 1))
    with col2:
        end_date = st.date_input("תאריך סיום", value=date.today() - timedelta(days=1))

    initial_investment = st.number_input("השקעה ראשונית ($)", min_value=100, max_value=10_000_000,
                                          value=10_000, step=500)

    st.markdown("---")
    st.subheader("📤 כללי מכירה (עלייה)")
    sell_rules = []
    num_sell = st.number_input("מספר כללי מכירה", min_value=1, max_value=5, value=1, step=1, key="ns")
    for i in range(int(num_sell)):
        with st.expander(f"כלל מכירה #{i+1}", expanded=True):
            sp = st.number_input(f"מכור כשהמניה עולה ב-%", min_value=0.1, max_value=500.0,
                                  value=10.0 * (i + 1), step=0.5, key=f"sp{i}")
            sa = st.number_input(f"כמה % מהאחזקה למכור", min_value=1.0, max_value=100.0,
                                  value=25.0, step=5.0, key=f"sa{i}")
            sell_rules.append((sp, sa))

    st.markdown("---")
    st.subheader("📥 כללי קנייה (ירידה)")
    buy_rules = []
    num_buy = st.number_input("מספר כללי קנייה", min_value=1, max_value=5, value=1, step=1, key="nb")
    for i in range(int(num_buy)):
        with st.expander(f"כלל קנייה #{i+1}", expanded=True):
            bp = st.number_input(f"קנה כשהמניה יורדת ב-%", min_value=0.1, max_value=90.0,
                                  value=10.0 * (i + 1), step=0.5, key=f"bp{i}")
            ba = st.number_input(f"כמה % מהמזומן להשקיע", min_value=1.0, max_value=100.0,
                                  value=25.0, step=5.0, key=f"ba{i}")
            buy_rules.append((bp, ba))

    run_btn = st.button("▶️  הרץ סימולציה", use_container_width=True, type="primary")

# ── Simulation logic ─────────────────────────────────────────────────────────

def run_simulation(prices: pd.Series, initial_cash: float, sell_rules, buy_rules):
    """
    prices      : daily close prices (sorted ascending)
    sell_rules  : list of (pct_rise, pct_to_sell)   — triggered from last buy/reference price
    buy_rules   : list of (pct_drop, pct_cash_to_buy) — triggered from last sell/reference price
    Returns DataFrame with daily portfolio value and a trade log.
    """
    cash = initial_cash
    shares = 0.0
    trades = []

    # Buy all shares on day 1
    first_price = prices.iloc[0]
    shares = cash / first_price
    cash = 0.0
    trades.append({"date": prices.index[0], "action": "קנייה ראשונית",
                   "price": first_price, "shares": shares, "cash": cash})

    # Sort rules ascending so we apply smallest first
    sell_rules_sorted = sorted(sell_rules, key=lambda x: x[0])
    buy_rules_sorted  = sorted(buy_rules,  key=lambda x: x[0])

    # Track "reference price" for each rule independently
    sell_ref = {i: first_price for i in range(len(sell_rules_sorted))}
    buy_ref  = {i: first_price for i in range(len(buy_rules_sorted))}

    portfolio_values = []

    for dt, price in prices.items():
        portfolio_values.append({"date": dt, "portfolio": cash + shares * price})

        # Check sell rules
        for i, (pct_rise, pct_sell) in enumerate(sell_rules_sorted):
            trigger_price = sell_ref[i] * (1 + pct_rise / 100)
            if price >= trigger_price and shares > 0:
                exec_price = trigger_price  # מכירה במחיר הסף המדויק
                shares_to_sell = shares * (pct_sell / 100)
                cash += shares_to_sell * exec_price
                shares -= shares_to_sell
                trades.append({"date": dt, "action": f"מכירה ({pct_rise}% עלייה)",
                               "price": exec_price, "shares": -shares_to_sell, "cash": cash})
                sell_ref[i] = exec_price
                for j in range(len(buy_rules_sorted)):
                    buy_ref[j] = exec_price

        # Check buy rules
        for i, (pct_drop, pct_cash) in enumerate(buy_rules_sorted):
            trigger_price = buy_ref[i] * (1 - pct_drop / 100)
            if price <= trigger_price and cash > 0:
                exec_price = trigger_price  # קנייה במחיר הסף המדויק
                cash_to_invest = cash * (pct_cash / 100)
                new_shares = cash_to_invest / exec_price
                shares += new_shares
                cash -= cash_to_invest
                trades.append({"date": dt, "action": f"קנייה ({pct_drop}% ירידה)",
                               "price": exec_price, "shares": new_shares, "cash": cash})
                buy_ref[i] = exec_price
                for j in range(len(sell_rules_sorted)):
                    sell_ref[j] = exec_price

    final_value = cash + shares * prices.iloc[-1]
    return pd.DataFrame(portfolio_values).set_index("date"), pd.DataFrame(trades), final_value


# ── Main ─────────────────────────────────────────────────────────────────────

if run_btn:
    if start_date >= end_date:
        st.error("תאריך ההתחלה חייב להיות לפני תאריך הסיום.")
        st.stop()

    with st.spinner(f"מוריד נתונים עבור {ticker}..."):
        try:
            df = yf.download(ticker, start=start_date, end=end_date, auto_adjust=False, progress=False)
        except Exception as e:
            st.error(f"שגיאה בהורדת נתונים: {e}")
            st.stop()

    if df.empty:
        st.error(f"לא נמצאו נתונים עבור הטיקר '{ticker}'. בדוק שהטיקר נכון.")
        st.stop()

    close = df["Close"]
    if isinstance(close.columns if hasattr(close, "columns") else None, pd.MultiIndex):
        close = close.iloc[:, 0]
    prices = close.squeeze().dropna()

    portfolio_df, trades_df, final_value = run_simulation(
        prices, initial_investment, sell_rules, buy_rules
    )

    # Buy & Hold benchmark
    bh_shares = initial_investment / prices.iloc[0]
    bh_values  = (prices * bh_shares).rename("portfolio")

    profit_strategy  = final_value - initial_investment
    profit_bh        = bh_values.iloc[-1] - initial_investment
    pct_strategy     = profit_strategy / initial_investment * 100
    pct_bh           = profit_bh       / initial_investment * 100

    # ── Metrics ──────────────────────────────────────────────────────────────
    st.subheader(f"📊 תוצאות הסימולציה — {ticker}")

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        st.metric("השקעה ראשונית", f"${initial_investment:,.0f}")
    with c2:
        color = "normal" if profit_strategy >= 0 else "inverse"
        st.metric("שווי סופי (אסטרטגיה)", f"${final_value:,.0f}",
                  delta=f"{'+' if profit_strategy >= 0 else ''}{profit_strategy:,.0f}$ ({pct_strategy:.1f}%)")
    with c3:
        st.metric("שווי סופי (Buy & Hold)", f"${bh_values.iloc[-1]:,.0f}",
                  delta=f"{'+' if profit_bh >= 0 else ''}{profit_bh:,.0f}$ ({pct_bh:.1f}%)")
    with c4:
        alpha = profit_strategy - profit_bh
        st.metric("יתרון האסטרטגיה", f"${alpha:+,.0f}",
                  delta=f"{'✅ עדיפה' if alpha >= 0 else '❌ נחותה'}")

    st.markdown("---")

    # ── Chart ─────────────────────────────────────────────────────────────────
    fig = go.Figure()

    fig.add_trace(go.Scatter(
        x=portfolio_df.index, y=portfolio_df["portfolio"],
        name="האסטרטגיה שלך", line=dict(color="#00b4d8", width=2)
    ))
    fig.add_trace(go.Scatter(
        x=bh_values.index, y=bh_values.values,
        name="Buy & Hold", line=dict(color="#f77f00", width=2, dash="dash")
    ))

    # Mark trades
    if not trades_df.empty:
        buy_trades  = trades_df[trades_df["action"].str.contains("קנייה")]
        sell_trades = trades_df[trades_df["action"].str.contains("מכירה")]

        for _, row in buy_trades.iterrows():
            if row["date"] in portfolio_df.index:
                fig.add_trace(go.Scatter(
                    x=[row["date"]], y=[portfolio_df.loc[row["date"], "portfolio"]],
                    mode="markers", marker=dict(color="lime", size=10, symbol="triangle-up"),
                    name="קנייה", showlegend=False,
                    hovertext=f"קנייה @ ${row['price']:.2f}"
                ))
        for _, row in sell_trades.iterrows():
            if row["date"] in portfolio_df.index:
                fig.add_trace(go.Scatter(
                    x=[row["date"]], y=[portfolio_df.loc[row["date"], "portfolio"]],
                    mode="markers", marker=dict(color="red", size=10, symbol="triangle-down"),
                    name="מכירה", showlegend=False,
                    hovertext=f"מכירה @ ${row['price']:.2f}"
                ))

    fig.update_layout(
        title=f"שווי תיק לאורך זמן — {ticker}",
        xaxis_title="תאריך", yaxis_title="שווי ($)",
        hovermode="x unified",
        legend=dict(orientation="h", y=1.02),
        template="plotly_dark",
        height=500
    )
    st.plotly_chart(fig, use_container_width=True)

    # ── Trade log ────────────────────────────────────────────────────────────
    st.subheader("📋 יומן עסקאות")
    if trades_df.empty:
        st.info("לא בוצעו עסקאות לפי הכללים שהוגדרו.")
    else:
        display_df = trades_df.copy()
        display_df["date"]   = pd.to_datetime(display_df["date"]).dt.strftime("%d/%m/%Y")
        display_df["price"]  = display_df["price"].map("${:,.2f}".format)
        display_df["shares"] = display_df["shares"].map("{:+.4f}".format)
        display_df["cash"]   = display_df["cash"].map("${:,.2f}".format)
        display_df.columns   = ["תאריך", "פעולה", "מחיר", "מניות", "מזומן"]
        st.dataframe(display_df, use_container_width=True, hide_index=True)

else:
    st.info("👈 מלא את הפרמטרים בצד שמאל ולחץ **הרץ סימולציה**")
    st.markdown("""
    ### איך זה עובד?
    1. **בחר טיקר** — סמל המניה בבורסה (AMZN, AAPL, TSLA...)
    2. **הגדר תאריכים** — מתי ה"ניסוי" מתחיל ומסתיים
    3. **הזן סכום השקעה** — כמה כסף "השקעת" ביום הראשון
    4. **כללי מכירה** — "אם המניה עלתה 10% — מכור 25% מהאחזקה"
    5. **כללי קנייה** — "אם המניה ירדה 10% — השקע 25% מהמזומן"
    6. **ראה תוצאות** — גרף השוואה מול Buy & Hold ויומן עסקאות מלא
    """)
