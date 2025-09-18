(define-constant ERR-NOT-AUTHORIZED u4000)
(define-constant ERR-INVALID-AMOUNT u4001)
(define-constant ERR-NO-ROUTE u4002)
(define-constant ERR-SLIPPAGE u4003)
(define-constant ERR-INVALID-PAIR u4004)
(define-constant ERR-INVALID-FEE u4005)
(define-constant ERR-PAIR-ALREADY-EXISTS u4006)
(define-constant ERR-PAIR-NOT-FOUND u4007)
(define-constant ERR-INVALID-TOKEN u4008)
(define-constant ERR-INSUFFICIENT-LIQUIDITY u4009)
(define-constant ERR-INVALID-PATH u4010)
(define-constant ERR-MAX-PATH-LENGTH u4011)
(define-constant ERR-FEE-TRANSFER-FAILED u4012)
(define-constant ERR-SWAP-FAILED u4013)
(define-constant ERR-INVALID-MIN-OUT u4014)
(define-constant ERR-PAUSED u4015)
(define-constant ERR-INVALID-ADMIN u4016)
(define-constant ERR-INVALID-ORACLE u4017)
(define-constant ERR-STALE-PRICE u4018)
(define-constant ERR-INVALID-DECIMALS u4019)
(define-constant ERR-MATH-OVERFLOW u4020)

(define-data-var admin principal tx-sender)
(define-data-var protocol-fee uint u100)
(define-data-var fee-recipient principal tx-sender)
(define-data-var paused bool false)
(define-data-var max-path-length uint u5)
(define-data-var oracle-contract principal 'SP000000000000000000002Q6VF78.price-oracle)
(define-data-var liquidity-threshold uint u1000000)

(define-map supported-tokens principal bool)
(define-map pairs 
  { from: principal, to: principal }
  { fee: uint, active: bool }
)
(define-map routes 
  { from: principal, to: principal }
  (list 5 principal)
)

(define-read-only (get-pair (from principal) (to principal))
  (map-get? pairs { from: from, to: to })
)

(define-read-only (get-route (from principal) (to principal))
  (map-get? routes { from: from, to: to })
)

(define-read-only (is-token-supported (token principal))
  (default-to false (map-get? supported-tokens token))
)

(define-read-only (get-protocol-fee)
  (var-get protocol-fee)
)

(define-read-only (get-fee-recipient)
  (var-get fee-recipient)
)

(define-read-only (is-paused)
  (var-get paused)
)

(define-private (validate-token (token principal))
  (if (is-token-supported token)
    (ok true)
    (err ERR-INVALID-TOKEN))
)

(define-private (validate-amount (amount uint))
  (if (> amount u0)
    (ok true)
    (err ERR-INVALID-AMOUNT))
)

(define-private (validate-min-out (min-out uint))
  (if (> min-out u0)
    (ok true)
    (err ERR-INVALID-MIN-OUT))
)

(define-private (validate-fee (fee uint))
  (if (<= fee u500)
    (ok true)
    (err ERR-INVALID-FEE))
)

(define-private (validate-path (path (list 5 principal)))
  (if (and (> (len path) u1) (<= (len path) (var-get max-path-length)))
    (ok true)
    (err ERR-INVALID-PATH))
)

(define-private (validate-price (price { rate: uint, timestamp: uint }))
  (if (< (- block-height (get timestamp price)) u10)
    (ok true)
    (err ERR-STALE-PRICE))
)

(define-private (calculate-fee (amount uint) (fee-rate uint))
  (/ (* amount fee-rate) u10000)
)

(define-private (execute-single-swap (from-token principal) (to-token principal) (amount-in uint))
  (let (
    (pair (unwrap! (get-pair from-token to-token) (err ERR-INVALID-PAIR)))
    (price (unwrap! (contract-call? (var-get oracle-contract) get-price { currency1: from-token, currency2: to-token }) (err ERR-NO-ROUTE)))
    (amount-out (* amount-in (get rate price)))
    (fee (calculate-fee amount-out (get fee pair)))
    (net-out (- amount-out fee))
  )
    (try! (validate-price price))
    (asserts! (contract-call? from-token transfer amount-in tx-sender (as-contract tx-sender) none) (err ERR-SWAP-FAILED))
    (asserts! (as-contract (contract-call? to-token transfer net-out tx-sender none)) (err ERR-SWAP-FAILED))
    (asserts! (stx-transfer? fee tx-sender (var-get fee-recipient)) (err ERR-FEE-TRANSFER-FAILED))
    (ok net-out)
  )
)

(define-private (execute-multi-hop (path (list 5 principal)) (amount-in uint))
  (fold execute-hop (cdr path) (ok { current-token: (element-at path u0), amount: amount-in }))
)

(define-private (execute-hop (next-token principal) (prev-result (response { current-token: principal, amount: uint } uint)))
  (match prev-result
    res (let (
          (current-token (get current-token res))
          (amount (get amount res))
        )
          (execute-single-swap current-token next-token amount)
        )
    err (err err)
  )
)

(define-public (add-token (token principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (try! (validate-token token))
    (map-set supported-tokens token true)
    (ok true)
  )
)

(define-public (add-pair (from principal) (to principal) (fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (try! (validate-token from))
    (try! (validate-token to))
    (try! (validate-fee fee))
    (asserts! (is-none (get-pair from to)) (err ERR-PAIR-ALREADY-EXISTS))
    (map-set pairs { from: from, to: to } { fee: fee, active: true })
    (ok true)
  )
)

(define-public (set-route (from principal) (to principal) (path (list 5 principal)))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (try! (validate-path path))
    (asserts! (is-eq (element-at path u0) from) (err ERR-INVALID-PATH))
    (asserts! (is-eq (unwrap! (last path) (err ERR-INVALID-PATH)) to) (err ERR-INVALID-PATH))
    (map-set routes { from: from, to: to } path)
    (ok true)
  )
)

(define-public (swap (from-token principal) (to-token principal) (amount uint) (min-out uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR-PAUSED))
    (try! (validate-amount amount))
    (try! (validate-min-out min-out))
    (try! (validate-token from-token))
    (try! (validate-token to-token))
    (let (
      (route (default-to (list from-token to-token) (get-route from-token to-token)))
      (output (if (> (len route) u2)
                (unwrap! (execute-multi-hop route amount) (err ERR-SWAP-FAILED))
                (unwrap! (execute-single-swap from-token to-token amount) (err ERR-SWAP-FAILED))
              ))
    )
      (asserts! (>= output min-out) (err ERR-SLIPPAGE))
      (print { event: "swap-executed", from: from-token, to: to-token, amount-in: amount, amount-out: output })
      (ok output)
    )
  )
)

(define-public (set-protocol-fee (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (try! (validate-fee new-fee))
    (var-set protocol-fee new-fee)
    (ok true)
  )
)

(define-public (set-fee-recipient (new-recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set fee-recipient new-recipient)
    (ok true)
  )
)

(define-public (pause)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set paused true)
    (ok true)
  )
)

(define-public (unpause)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set paused false)
    (ok true)
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set admin new-admin)
    (ok true)
  )
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-contract new-oracle)
    (ok true)
  )
)