// OANDAConnector — implementasi Connector untuk OANDA v20 (REST + pricing stream).
//
// Langkah 1: read-only (AccountSummary/Positions/Trades). PlaceOrder/Close*/
// PriceStream menyusul di langkah berikutnya (stub di bawah).
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type OANDAConnector struct {
	token     string
	accountID string
	env       string // practice | live
	hc        *http.Client
}

func NewOANDAConnector(c BrokerCreds) *OANDAConnector {
	return &OANDAConnector{
		token:     c.Token,
		accountID: c.AccountID,
		env:       c.Env,
		hc:        &http.Client{Timeout: 15 * time.Second},
	}
}

func (o *OANDAConnector) Name() string { return "oanda" }

// restHost = host REST (beda dari stream host).
func (o *OANDAConnector) restHost() string {
	if o.env == "live" {
		return "https://api-fxtrade.oanda.com"
	}
	return "https://api-fxpractice.oanda.com"
}

// acctPath membangun path /v3/accounts/{id}/<suffix>.
func (o *OANDAConnector) acctPath(suffix string) string {
	return o.restHost() + "/v3/accounts/" + url.PathEscape(o.accountID) + suffix
}

// doGET menjalankan GET ber-Bearer dan men-decode JSON ke out.
func (o *OANDAConnector) doGET(ctx context.Context, fullURL string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+o.token)
	req.Header.Set("Accept-Datetime-Format", "RFC3339")
	resp, err := o.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("oanda GET %d: %s", resp.StatusCode, truncate(body, 300))
	}
	return json.Unmarshal(body, out)
}

func (o *OANDAConnector) AccountSummary(ctx context.Context) (Account, error) {
	var r struct {
		Account struct {
			ID                string `json:"id"`
			Currency          string `json:"currency"`
			Balance           string `json:"balance"`
			NAV               string `json:"NAV"`
			UnrealizedPL      string `json:"unrealizedPL"`
			MarginUsed        string `json:"marginUsed"`
			MarginAvailable   string `json:"marginAvailable"`
			OpenPositionCount int    `json:"openPositionCount"`
		} `json:"account"`
	}
	if err := o.doGET(ctx, o.acctPath("/summary"), &r); err != nil {
		return Account{}, err
	}
	a := r.Account
	return Account{
		ID:                a.ID,
		Currency:          a.Currency,
		Balance:           parseF(a.Balance),
		Equity:            parseF(a.NAV),
		UnrealizedPL:      parseF(a.UnrealizedPL),
		MarginUsed:        parseF(a.MarginUsed),
		MarginAvailable:   parseF(a.MarginAvailable),
		OpenPositionCount: a.OpenPositionCount,
	}, nil
}

func (o *OANDAConnector) Positions(ctx context.Context) ([]Position, error) {
	var r struct {
		Positions []struct {
			Instrument string `json:"instrument"`
			Long       struct {
				Units        string `json:"units"`
				AveragePrice string `json:"averagePrice"`
			} `json:"long"`
			Short struct {
				Units        string `json:"units"`
				AveragePrice string `json:"averagePrice"`
			} `json:"short"`
			UnrealizedPL string `json:"unrealizedPL"`
		} `json:"positions"`
	}
	if err := o.doGET(ctx, o.acctPath("/openPositions"), &r); err != nil {
		return nil, err
	}
	out := make([]Position, 0, len(r.Positions))
	for _, p := range r.Positions {
		long, short := parseF(p.Long.Units), parseF(p.Short.Units)
		units := long + short // short.units sudah negatif dari OANDA
		avg := parseF(p.Long.AveragePrice)
		if units < 0 {
			avg = parseF(p.Short.AveragePrice)
		}
		out = append(out, Position{
			Instrument:   Instrument(p.Instrument),
			Units:        units,
			AvgPrice:     avg,
			UnrealizedPL: parseF(p.UnrealizedPL),
		})
	}
	return out, nil
}

func (o *OANDAConnector) Trades(ctx context.Context) ([]Trade, error) {
	var r struct {
		Trades []struct {
			ID              string `json:"id"`
			Instrument      string `json:"instrument"`
			CurrentUnits    string `json:"currentUnits"`
			Price           string `json:"price"`
			UnrealizedPL    string `json:"unrealizedPL"`
			OpenTime        string `json:"openTime"`
			StopLossOrder   *struct {
				Price string `json:"price"`
			} `json:"stopLossOrder"`
			TakeProfitOrder *struct {
				Price string `json:"price"`
			} `json:"takeProfitOrder"`
		} `json:"trades"`
	}
	if err := o.doGET(ctx, o.acctPath("/openTrades"), &r); err != nil {
		return nil, err
	}
	out := make([]Trade, 0, len(r.Trades))
	for _, t := range r.Trades {
		tr := Trade{
			ID:           t.ID,
			Instrument:   Instrument(t.Instrument),
			Units:        parseF(t.CurrentUnits),
			Price:        parseF(t.Price),
			UnrealizedPL: parseF(t.UnrealizedPL),
			OpenTime:     t.OpenTime,
		}
		if t.StopLossOrder != nil {
			v := parseF(t.StopLossOrder.Price)
			tr.SL = &v
		}
		if t.TakeProfitOrder != nil {
			v := parseF(t.TakeProfitOrder.Price)
			tr.TP = &v
		}
		out = append(out, tr)
	}
	return out, nil
}

// doBody menjalankan request ber-Bearer dengan body JSON, mengembalikan status +
// raw body. Dipakai POST (order) & PUT (close).
func (o *OANDAConnector) doBody(ctx context.Context, method, fullURL string, payload any) (int, []byte, error) {
	var buf io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		buf = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, fullURL, buf)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+o.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Datetime-Format", "RFC3339")
	resp, err := o.hc.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, body, nil
}

// fmtUnits memformat units bertanda (Sell = negatif) sebagai string untuk OANDA.
func fmtUnits(side Side, units float64) string {
	if side == Sell {
		units = -units
	}
	return strconv.FormatFloat(units, 'f', -1, 64)
}

func fmtPrice(p float64) string { return strconv.FormatFloat(p, 'f', -1, 64) }

func (o *OANDAConnector) PlaceOrder(ctx context.Context, req OrderRequest) (OrderResult, error) {
	// Bangun body order OANDA dari OrderRequest tervalidasi.
	order := map[string]any{
		"instrument":   string(req.Instrument),
		"units":        fmtUnits(req.Side, req.Units),
		"positionFill": "DEFAULT",
	}
	switch req.Type {
	case Market:
		order["type"] = "MARKET"
		order["timeInForce"] = "FOK"
	case Limit:
		order["type"] = "LIMIT"
		order["timeInForce"] = "GTC"
		if req.Price != nil {
			order["price"] = fmtPrice(*req.Price)
		}
	case Stop:
		order["type"] = "STOP"
		order["timeInForce"] = "GTC"
		if req.Price != nil {
			order["price"] = fmtPrice(*req.Price)
		}
	}
	if req.SL != nil {
		order["stopLossOnFill"] = map[string]string{"price": fmtPrice(*req.SL)}
	}
	if req.TP != nil {
		order["takeProfitOnFill"] = map[string]string{"price": fmtPrice(*req.TP)}
	}
	if req.TrailDist != nil {
		order["trailingStopLossOnFill"] = map[string]string{"distance": fmtPrice(*req.TrailDist)}
	}
	if req.ClientTag != "" {
		order["clientExtensions"] = map[string]string{"id": req.ClientTag}
	}

	status, body, err := o.doBody(ctx, http.MethodPost, o.acctPath("/orders"), map[string]any{"order": order})
	if err != nil {
		return OrderResult{}, err
	}
	res := OrderResult{Raw: json.RawMessage(body)}
	if status < 200 || status >= 300 {
		res.Status = "REJECTED"
		return res, fmt.Errorf("oanda order %d: %s", status, truncate(body, 300))
	}

	// Parse transaksi hasil order.
	var pr struct {
		OrderFillTransaction *struct {
			ID         string `json:"id"`
			Price      string `json:"price"`
			Units      string `json:"units"`
			TradeOpened *struct {
				TradeID string `json:"tradeID"`
				Units   string `json:"units"`
			} `json:"tradeOpened"`
		} `json:"orderFillTransaction"`
		OrderCreateTransaction *struct {
			ID string `json:"id"`
		} `json:"orderCreateTransaction"`
		OrderCancelTransaction *struct {
			ID     string `json:"id"`
			Reason string `json:"reason"`
		} `json:"orderCancelTransaction"`
	}
	_ = json.Unmarshal(body, &pr)

	switch {
	case pr.OrderCancelTransaction != nil:
		res.Status = "REJECTED"
		return res, fmt.Errorf("order ditolak broker: %s", pr.OrderCancelTransaction.Reason)
	case pr.OrderFillTransaction != nil:
		f := pr.OrderFillTransaction
		res.Status = "FILLED"
		res.BrokerOrderID = f.ID
		fp := parseF(f.Price)
		res.FillPrice = &fp
		res.FilledUnits = parseF(f.Units)
		if f.TradeOpened != nil {
			res.BrokerTradeID = f.TradeOpened.TradeID
		}
	case pr.OrderCreateTransaction != nil:
		res.Status = "PENDING"
		res.BrokerOrderID = pr.OrderCreateTransaction.ID
	default:
		res.Status = "UNKNOWN"
	}
	return res, nil
}

func (o *OANDAConnector) ClosePosition(ctx context.Context, inst Instrument) (OrderResult, error) {
	return OrderResult{}, fmt.Errorf("ClosePosition belum diimplementasi (Langkah 3)")
}

func (o *OANDAConnector) CloseTrade(ctx context.Context, tradeID string, units float64) (OrderResult, error) {
	return OrderResult{}, fmt.Errorf("CloseTrade belum diimplementasi (Langkah 3)")
}

func (o *OANDAConnector) PriceStream(ctx context.Context, insts []Instrument, ch chan<- Tick) error {
	return fmt.Errorf("PriceStream belum diimplementasi (Langkah 4)")
}

// --- util ---

func parseF(s string) float64 {
	f, _ := strconv.ParseFloat(s, 64)
	return f
}

func truncate(b []byte, n int) string {
	if len(b) > n {
		return string(b[:n]) + "…"
	}
	return string(b)
}
