// Catalog content. This is authored material -- my own explainers and hints --
// plus problem titles, difficulties and links. No problem statements.

export const TOPICS = [
  { slug: 'arrays',              name: 'Arrays',              prereqs: [],                                blurb: 'Indexing, scanning, and in-place manipulation.' },
  { slug: 'hashing',             name: 'Hashing',             prereqs: ['arrays'],                        blurb: 'Trading memory for lookup time.' },
  { slug: 'two-pointers',        name: 'Two Pointers',        prereqs: ['arrays'],                        blurb: 'Two indices moving under a rule instead of a nested loop.' },
  { slug: 'sliding-window',      name: 'Sliding Window',      prereqs: ['two-pointers', 'hashing'],       blurb: 'A contiguous range that grows and shrinks while a condition holds.' },
  { slug: 'binary-search',       name: 'Binary Search',       prereqs: ['arrays'],                        blurb: 'Halving a monotonic search space.' },
  { slug: 'stack',               name: 'Stack',               prereqs: ['arrays'],                        blurb: 'Deferring work until the element that resolves it arrives.' },
  { slug: 'trees',               name: 'Trees',               prereqs: ['stack'],                         blurb: 'Recursion over a hierarchy; the call stack is the data structure.' },
  { slug: 'graphs',              name: 'Graphs',              prereqs: ['trees', 'hashing'],              blurb: 'Trees, but with cycles and no root.' },
  { slug: 'dynamic-programming', name: 'Dynamic Programming', prereqs: ['arrays', 'hashing'],             blurb: 'Reusing answers to overlapping subproblems.' },
];

export const PATTERNS = [
  {
    slug: 'prefix-sum',
    topic: 'arrays',
    name: 'Prefix sum',
    explainer:
      'Precompute running totals so any range sum becomes one subtraction. If a question asks about the sum of a subarray and you are looping twice to compute it, you are recomputing work you already did. Build P where P[i] is the sum of everything before i; then sum(i..j) is P[j+1] - P[i]. The variant worth internalising: to count subarrays summing to k, walk once keeping a hash map of prefix sums seen so far and look for P[i] - k. That turns O(n^2) into O(n).',
    hints: [
      'What quantity, if you already had it for every index, would make each query O(1)?',
      'Write down the running total before each index. Now express the sum from i to j using only two of those numbers.',
      'For a counting question, keep a hash map from running total to how many times it has occurred, and at each step ask how many earlier totals equal current - k.',
    ],
  },
  {
    slug: 'complement-hashing',
    topic: 'hashing',
    name: 'Complement lookup',
    explainer:
      'When you need to find a partner for each element, do not search for it -- remember what you have seen. One pass, a hash map or set, and each element asks "has my complement already gone by?" The general move is: convert an O(n^2) "for each pair" into an O(n) "for each element, one lookup". The harder version is choosing the right key: for anagrams the key is the sorted string or a letter count; for consecutive sequences the key is the value itself and you only start counting from a value with no predecessor.',
    hints: [
      'You are checking pairs. What would you need to have stored to answer each element in one step?',
      'Iterate once. Before storing the current element, ask the map whether the thing that completes it is already there.',
      'If the pairing is not equality, design the key: sorted characters, a frequency signature, or value - 1 to detect the start of a run.',
    ],
  },
  {
    slug: 'fast-and-slow-pointers',
    topic: 'two-pointers',
    name: 'Fast and slow pointers',
    explainer:
      'Two pointers over the same sequence at different speeds. Advance one by 1 and the other by 2: if there is a cycle they must eventually collide, and if there is not, the fast one falls off the end while the slow one sits at the midpoint. The result people forget is the second phase: after they meet, reset one pointer to the start and step both by 1 -- they meet again exactly at the cycle entrance. It works on anything with a "next" function, not just linked lists, which is why it solves Happy Number and Find the Duplicate Number too.',
    hints: [
      'You are asked about structure in a sequence you can only walk forwards, with O(1) memory. What happens if you walk it at two different speeds?',
      'Step one pointer once and the other twice per iteration. What does a collision prove? What does reaching the end prove?',
      'To find where the cycle starts: after the meeting point, put one pointer back at the head and advance both one step at a time.',
    ],
  },
  {
    slug: 'variable-sliding-window',
    topic: 'sliding-window',
    name: 'Variable-size sliding window',
    explainer:
      'Keep a contiguous range [left, right] and a small amount of state describing it. Extend right unconditionally; while the range violates the constraint, contract left. Every element enters and leaves at most once, so it is O(n) despite the inner loop. The whole skill is picking the state: a character count for "no repeats", a running sum for "sum at least k", a max-frequency for "at most k replacements". If your state cannot be updated in O(1) when an element enters or leaves, you have picked the wrong state.',
    hints: [
      'The answer is a contiguous range. Can you decide when to grow it and when to shrink it, instead of trying every start?',
      'Grow right every iteration. Shrink left in a while-loop for exactly as long as the window is invalid. Record the answer where the window is valid.',
      'Name the state you keep about the window, and check you can add and remove one element from it in constant time.',
    ],
  },
  {
    slug: 'binary-search-on-answer',
    topic: 'binary-search',
    name: 'Binary search on the answer',
    explainer:
      'The array is not what you search -- the answer is. When a problem asks for a minimum capacity, smallest divisor, or fewest days, and you can cheaply check "is X good enough?", then goodness is monotonic: once X works, every larger X works. That makes the space of candidate answers a sorted boolean array, and binary search finds the boundary in log(range) checks. Two steps, always: define the predicate feasible(X), then confirm it is monotonic. If it is not monotonic, this pattern does not apply and no amount of index fiddling will save it.',
    hints: [
      'You are being asked to minimise or maximise a value. Is it easier to check whether a specific value works than to construct the best one?',
      'Write feasible(X) as a plain O(n) loop. Then argue that if feasible(X) is true, feasible(X+1) is true as well.',
      'Binary search the range of possible answers, not the input. Keep the invariant that hi is always feasible and lo - 1 never is.',
    ],
  },
  {
    slug: 'monotonic-stack',
    topic: 'stack',
    name: 'Monotonic stack',
    explainer:
      'A stack whose contents are kept sorted, used to answer "next greater / previous smaller" questions in one pass. Walk the input; before pushing the current element, pop everything the current element beats. The moment you pop something, you have found its answer -- the current element is its next greater (or smaller) neighbour. Each element is pushed and popped once, so O(n). Histogram and rain-water problems are this pattern wearing a costume: the popped bar plus its two bounding neighbours define a rectangle you can finalise immediately.',
    hints: [
      'For each element you want the nearest later element that is bigger. Which elements can you throw away permanently once a bigger one appears?',
      'Keep a stack of indices with decreasing values. When the current value exceeds the top, pop -- and the current index is the answer for what you popped.',
      'For area problems, the popped index is the height and the new stack top plus the current index give the left and right walls.',
    ],
  },
  {
    slug: 'dfs-tree-recursion',
    topic: 'trees',
    name: 'DFS with a return value',
    explainer:
      'Recursion on a tree is a contract: decide what the call on a node returns, assume the children already honour it, and combine. Most tree problems reduce to choosing that return value. Depth returns a height. Validation returns a legal range, or uses an in-order walk that must be increasing. Lowest common ancestor returns "did my subtree contain a target". The awkward ones return two things -- Binary Tree Maximum Path Sum returns the best downward path while separately updating a global best that may bend through the node. When a single return value cannot carry both, return a pair rather than reaching for iteration.',
    hints: [
      'What single value would a recursive call on a node have to return for the parent to finish its own work in O(1)?',
      'Write the base case for null first, then combine the left and right results. Do not think about the whole tree.',
      'If the answer at a node is not the same shape as what the parent needs, return the parent-facing value and update a separate accumulator for the answer.',
    ],
  },
  {
    slug: 'bfs-shortest-path',
    topic: 'graphs',
    name: 'BFS for shortest path',
    explainer:
      'On an unweighted graph, breadth-first search visits nodes in order of distance, so the first time you reach a node you have reached it by a shortest path. The mechanics are always the same: a queue, a visited set marked at enqueue time (not dequeue -- that is the classic duplicate bug), and processing level by level when you need the distance. Multi-source is the same algorithm with several nodes seeded into the queue at once, which is what makes Rotting Oranges and 01 Matrix fall out immediately. Grids are graphs: the neighbours are the four cells around you.',
    hints: [
      'The graph has no edge weights and you want the fewest steps. Which traversal order guarantees the first arrival is the best arrival?',
      'Use a queue, and mark a node visited the moment you enqueue it, not when you pop it.',
      'If several starting points are equally valid, push all of them into the queue before the loop begins and let one pass handle them together.',
    ],
  },
];

// [slug, title, difficulty, topic, [primaryPattern, ...secondaryPatterns]]
export const PROBLEMS = [
  ['running-sum-of-1d-array',            'Running Sum of 1d Array',                        'easy',   'arrays',         ['prefix-sum']],
  ['find-pivot-index',                   'Find Pivot Index',                               'easy',   'arrays',         ['prefix-sum']],
  ['range-sum-query-immutable',          'Range Sum Query - Immutable',                    'easy',   'arrays',         ['prefix-sum']],
  ['subarray-sum-equals-k',              'Subarray Sum Equals K',                          'medium', 'arrays',         ['prefix-sum', 'complement-hashing']],
  ['product-of-array-except-self',       'Product of Array Except Self',                   'medium', 'arrays',         ['prefix-sum']],
  ['maximum-size-subarray-sum-equals-k', 'Maximum Size Subarray Sum Equals k',             'medium', 'arrays',         ['prefix-sum', 'complement-hashing']],

  ['two-sum',                            'Two Sum',                                        'easy',   'hashing',        ['complement-hashing']],
  ['contains-duplicate',                 'Contains Duplicate',                             'easy',   'hashing',        ['complement-hashing']],
  ['valid-anagram',                      'Valid Anagram',                                  'easy',   'hashing',        ['complement-hashing']],
  ['group-anagrams',                     'Group Anagrams',                                 'medium', 'hashing',        ['complement-hashing']],
  ['top-k-frequent-elements',            'Top K Frequent Elements',                        'medium', 'hashing',        ['complement-hashing']],
  ['longest-consecutive-sequence',       'Longest Consecutive Sequence',                   'medium', 'hashing',        ['complement-hashing']],

  ['linked-list-cycle',                  'Linked List Cycle',                              'easy',   'two-pointers',   ['fast-and-slow-pointers']],
  ['middle-of-the-linked-list',          'Middle of the Linked List',                      'easy',   'two-pointers',   ['fast-and-slow-pointers']],
  ['happy-number',                       'Happy Number',                                   'easy',   'two-pointers',   ['fast-and-slow-pointers']],
  ['linked-list-cycle-ii',               'Linked List Cycle II',                           'medium', 'two-pointers',   ['fast-and-slow-pointers']],
  ['find-the-duplicate-number',          'Find the Duplicate Number',                      'medium', 'two-pointers',   ['fast-and-slow-pointers', 'complement-hashing']],
  ['reorder-list',                       'Reorder List',                                   'medium', 'two-pointers',   ['fast-and-slow-pointers']],

  ['max-consecutive-ones-iii',           'Max Consecutive Ones III',                       'medium', 'sliding-window', ['variable-sliding-window']],
  ['longest-substring-without-repeating-characters', 'Longest Substring Without Repeating Characters', 'medium', 'sliding-window', ['variable-sliding-window', 'complement-hashing']],
  ['minimum-size-subarray-sum',          'Minimum Size Subarray Sum',                      'medium', 'sliding-window', ['variable-sliding-window']],
  ['longest-repeating-character-replacement', 'Longest Repeating Character Replacement',   'medium', 'sliding-window', ['variable-sliding-window']],
  ['permutation-in-string',              'Permutation in String',                          'medium', 'sliding-window', ['variable-sliding-window', 'complement-hashing']],
  ['minimum-window-substring',           'Minimum Window Substring',                       'hard',   'sliding-window', ['variable-sliding-window', 'complement-hashing']],

  ['koko-eating-bananas',                'Koko Eating Bananas',                            'medium', 'binary-search',  ['binary-search-on-answer']],
  ['capacity-to-ship-packages-within-d-days', 'Capacity To Ship Packages Within D Days',   'medium', 'binary-search',  ['binary-search-on-answer']],
  ['find-the-smallest-divisor-given-a-threshold', 'Find the Smallest Divisor Given a Threshold', 'medium', 'binary-search', ['binary-search-on-answer']],
  ['minimum-number-of-days-to-make-m-bouquets', 'Minimum Number of Days to Make m Bouquets', 'medium', 'binary-search', ['binary-search-on-answer']],
  ['kth-smallest-element-in-a-sorted-matrix', 'Kth Smallest Element in a Sorted Matrix',   'medium', 'binary-search',  ['binary-search-on-answer']],
  ['split-array-largest-sum',            'Split Array Largest Sum',                        'hard',   'binary-search',  ['binary-search-on-answer']],

  ['next-greater-element-i',             'Next Greater Element I',                         'easy',   'stack',          ['monotonic-stack']],
  ['daily-temperatures',                 'Daily Temperatures',                             'medium', 'stack',          ['monotonic-stack']],
  ['remove-k-digits',                    'Remove K Digits',                                'medium', 'stack',          ['monotonic-stack']],
  ['sum-of-subarray-minimums',           'Sum of Subarray Minimums',                       'medium', 'stack',          ['monotonic-stack']],
  ['trapping-rain-water',                'Trapping Rain Water',                            'hard',   'stack',          ['monotonic-stack']],
  ['largest-rectangle-in-histogram',     'Largest Rectangle in Histogram',                 'hard',   'stack',          ['monotonic-stack']],

  ['maximum-depth-of-binary-tree',       'Maximum Depth of Binary Tree',                   'easy',   'trees',          ['dfs-tree-recursion']],
  ['same-tree',                          'Same Tree',                                      'easy',   'trees',          ['dfs-tree-recursion']],
  ['invert-binary-tree',                 'Invert Binary Tree',                             'easy',   'trees',          ['dfs-tree-recursion']],
  ['balanced-binary-tree',               'Balanced Binary Tree',                           'easy',   'trees',          ['dfs-tree-recursion']],
  ['validate-binary-search-tree',        'Validate Binary Search Tree',                   'medium', 'trees',          ['dfs-tree-recursion']],
  ['lowest-common-ancestor-of-a-binary-tree', 'Lowest Common Ancestor of a Binary Tree',   'medium', 'trees',          ['dfs-tree-recursion']],
  ['diameter-of-binary-tree',            'Diameter of Binary Tree',                        'medium', 'trees',          ['dfs-tree-recursion']],
  ['binary-tree-maximum-path-sum',       'Binary Tree Maximum Path Sum',                   'hard',   'trees',          ['dfs-tree-recursion']],

  ['flood-fill',                         'Flood Fill',                                     'easy',   'graphs',         ['bfs-shortest-path']],
  ['number-of-islands',                  'Number of Islands',                              'medium', 'graphs',         ['bfs-shortest-path']],
  ['rotting-oranges',                    'Rotting Oranges',                                'medium', 'graphs',         ['bfs-shortest-path']],
  ['01-matrix',                          '01 Matrix',                                      'medium', 'graphs',         ['bfs-shortest-path']],
  ['clone-graph',                        'Clone Graph',                                    'medium', 'graphs',         ['bfs-shortest-path', 'complement-hashing']],
  ['course-schedule',                    'Course Schedule',                                'medium', 'graphs',         ['bfs-shortest-path']],
  ['word-ladder',                        'Word Ladder',                                    'hard',   'graphs',         ['bfs-shortest-path', 'complement-hashing']],
];

export const problemUrl = (slug) => `https://leetcode.com/problems/${slug}/`;
