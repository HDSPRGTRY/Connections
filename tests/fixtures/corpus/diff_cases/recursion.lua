local function fib(n) if n < 2 then return n end return fib(n - 1) + fib(n - 2) end
print("fib", fib(15))
local is_odd
local function is_even(n) if n == 0 then return true end return is_odd(n - 1) end
function is_odd(n) if n == 0 then return false end return is_even(n - 1) end
print("mutual", is_even(10), is_odd(7), is_even(7))
local depth = 0
local function down(n) depth = depth + 1 if n > 0 then return down(n - 1) end return depth end
print("tail-ish", down(20))
local function fact(n) return n <= 1 and 1 or n * fact(n - 1) end
print("fact", fact(10))
