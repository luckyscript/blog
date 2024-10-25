---
title: 二叉查找树【Haskell实现】
date: 2016-03-07 16:00:00
external: false
permalink: /blog/2016/binary-search-tree
category: Functional Programming
tags:
  - Lisp
  - Haskell

---

### 定义

二叉查找树（Binary Search Tree），也称有序二叉树（ordered binary tree）,排序二叉树（sorted binary tree），是指一棵空树或者具有下列性质的二叉树：
1. 若任意节点的左子树不空，则左子树上所有结点的值均小于它的根结点的值；
2. 若任意节点的右子树不空，则右子树上所有结点的值均大于它的根结点的值；
3. 任意节点的左、右子树也分别为二叉查找树。
4. 没有键值相等的节点（no duplicate nodes）。

如下图，这个是普通的二叉树
![242108011547176](https://cloud.githubusercontent.com/assets/9391201/13770345/4d3c3044-eac1-11e5-93e9-27a01b4c146d.png)
在此基础上，加上节点之间的大小关系，就是二叉查找树：
![242108022794732](https://cloud.githubusercontent.com/assets/9391201/13770400/b7faa960-eac1-11e5-8cf2-dc789ebf92fb.png)
### 实现

``` Haskell
data Binary_Tree a = Null | Node {element::a,left_tree,right_tree::Binary_Tree a}
    deriving (Show,Eq)

max' :: (Integral b) => b -> b -> b
max' l r
    |(l > r)   = l
    |otherwise = r

size_of_tree :: (Integral b) => Binary_Tree a -> b
size_of_tree binary_tree = case binary_tree of
    Null        -> 0
    Node {element = _, left_tree = left, right_tree = right} -> size_of_tree left + size_of_tree right + 1

depth_of_tree :: (Integral b) => Binary_Tree a -> b
depth_of_tree binary_tree = case binary_tree of
    Null        -> 0
    Node {element = _, left_tree = left, right_tree = right} -> max' (depth_of_tree left) (depth_of_tree right) + 1

flatten_tree :: Binary_Tree a -> [a]
flatten_tree binary_tree = case binary_tree of
    Null -> []
    Node {element = x, left_tree = left, right_tree = right} -> x : (flatten_tree left ++ flatten_tree right)

leaves_of_tree ::(Eq a) => Binary_Tree a -> [a]
leaves_of_tree binary_tree = case binary_tree of 
    Null -> []
    Node {element = x, left_tree = left, right_tree = right}
        | left == Null && right == Null -> [x]
        | otherwise                     -> leaves_of_tree left ++ leaves_of_tree right
```
### 查找

查找操作和二分查找类似，将key和节点的key比较，如果小于，那么就在Left Node节点查找,如果大于，则在Right Node节点查找，如果相等，直接返回Value。
![242108031863290](https://cloud.githubusercontent.com/assets/9391201/13770712/ee2d7bb4-eac3-11e5-918c-0493c48e4c14.png)
该方法实现有迭代和递归两种。
### 插入

插入主要是判断应该插入的值依次进行比较，插入合适的位置。这里利用迭代来实现。

``` Haskell
insert_element_to_tree :: Ord a => a -> BS_Tree a -> BS_Tree a
insert_element_to_tree a bs_tree = case bs_tree of 
    Null    ->  Node {element = a, left_tree = Null, right_tree = Null}
    Node {element = x, left_tree = left, right_tree = right}
        | is_vaild_binary_search_tree bs_tree == False  -> error "not a vaild bs_tree"
        | x > a         -> insert_element_to_tree a left
        | otherwise     -> insert_element_to_tree a right

```

插入操作图示如下：
![242108044987088](https://cloud.githubusercontent.com/assets/9391201/13770830/bfecac74-eac4-11e5-833b-7c814a2ba428.png)
### 最大最小值

二叉查找树中，最左和最右节点即为最小值和最大值，所以我们只需递归调用即可。

``` Haskell
maximum' :: (Ord a) => BS_Tree a -> a
maximum' bs_tree = case bs_tree of
    Null        -> error "maximum of empty list" 
    Node {element = x, left_tree = left, right_tree = right}
        | right == Null     -> x
        | otherwise         -> maximum' right

minimum' :: (Ord a) => BS_Tree a -> a
minimum' bs_tree = case bs_tree of
    Null        -> error "maximum of empty list" 
    Node {element = x, left_tree = left, right_tree = right}
        | left == Null     -> x
        | otherwise         -> minimum' left
```
### 删除

删除元素操作在二叉树的操作中应该是比较复杂的。首先来看下比较简单的删除最大最小值得方法。
以删除最小值为例，我们首先找到最小值，及最左边左子树为空的节点，然后返回其右子树作为新的左子树。操作示意图如下：
![242109072177027](https://cloud.githubusercontent.com/assets/9391201/13770918/3da1073c-eac5-11e5-97f6-d224658398f7.png)
删除最大值也是类似。

现在来分析一般情况，假定我们要删除指定key的某一个节点。这个问题的难点在于：删除最大最小值的操作，删除的节点只有1个子节点或者没有子节点，这样比较简单。但是如果删除任意节点，就有可能出现删除的节点有0个，1 个，2个子节点的情况，现在来逐一分析。
- 当删除的节点没有子节点时，直接将该父节点指向该节点的link设置为null。
  ![242109092175683](https://cloud.githubusercontent.com/assets/9391201/13770934/51f9f496-eac5-11e5-8476-ed806f16663d.png)
- 当删除的节点只有1个子节点时，将该自己点替换为要删除的节点即可。
  ![242109117799766](https://cloud.githubusercontent.com/assets/9391201/13770946/6643dd86-eac5-11e5-8f22-f0326a246ecd.png)
- 当删除的节点有2个子节点时，问题就变复杂了。
  假设我们删除的节点t具有两个子节点。因为t具有右子节点，所以我们需要找到其右子节点中的最小节点，替换t节点的位置。这里有四个步骤：
- 保存带删除的节点到临时变量t
- 将t的右节点的最小节点min(t.right)保存到临时节点x
- 将x的右节点设置为deleteMin(t.right)，该右节点是删除后，所有比x.key最大的节点。
- 将x的做节点设置为t的左节点。

整个过程如下图
![242109141701837](https://cloud.githubusercontent.com/assets/9391201/13770964/7e3637ea-eac5-11e5-8535-b23581a93455.png)
### 分析

二叉查找树的运行时间和树的形状有关，树的形状又和插入元素的顺序有关。在最好的情况下，节点完全平衡，从根节点到最底层叶子节点只有lgN个节点。在最差的情况下，根节点到最底层叶子节点会有N各节点。在一般情况下，树的形状和最好的情况接近。
![242110209675830](https://cloud.githubusercontent.com/assets/9391201/13770989/a11d0130-eac5-11e5-912b-0302f204648b.png)
在分析二叉查找树的时候，我们通常会假设插入的元素顺序是随机的。对BST的分析类似与快速排序中的查找：

![242110231541728](https://cloud.githubusercontent.com/assets/9391201/13770991/a4627a3c-eac5-11e5-89fe-3e34c5f611a7.png)

BST中位于顶部的元素就是快速排序中的第一个划分的元素，该元素左边的元素全部小于该元素，右边的元素均大于该元素。

对于N个不同元素，随机插入的二叉查找树来说，其平均查找/插入的时间复杂度大约为2lnN，这个和快速排序的分析一样，具体的证明方法不再赘述，参照快速排序。
