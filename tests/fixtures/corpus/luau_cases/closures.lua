local function counter(start)
  local n = start
  return function(step)
    n = n + (step or 1)
    return n
  end
end
local c1, c2 = counter(10), counter(100)
print(c1(), c1(5), c2(), c1())
local function fib(k) if k < 2 then return k end return fib(k - 1) + fib(k - 2) end
print(fib(15))
local fns = {}
for i = 1, 3 do fns[i] = function() return i * 10 end end
print(fns[1](), fns[2](), fns[3]())
local function compose(f, g) return function(x) return f(g(x)) end end
print(compose(function(v) return v + 1 end, function(v) return v * 2 end)(5))
