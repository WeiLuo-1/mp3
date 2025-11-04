var User = require('../models/user');
var Task = require('../models/task');

module.exports = function (router) {
    var usersRoute = router.route('/users');
    var userByIdRoute = router.route('/users/:id');

    // Helper function to parse query string parameters
    function parseQueryParams(req) {
        var query = {};
        
        // Parse 'where' or 'filter' parameter (filter for compatibility with dbFill.py)
        if (req.query.where) {
            try {
                query.where = JSON.parse(req.query.where);
            } catch (e) {
                throw new Error('Invalid where parameter');
            }
        } else if (req.query.filter) {
            try {
                query.where = JSON.parse(req.query.filter);
            } catch (e) {
                throw new Error('Invalid filter parameter');
            }
        }

        // Parse 'sort' parameter
        if (req.query.sort) {
            try {
                query.sort = JSON.parse(req.query.sort);
            } catch (e) {
                throw new Error('Invalid sort parameter');
            }
        }

        // Parse 'select' parameter
        if (req.query.select) {
            try {
                query.select = JSON.parse(req.query.select);
            } catch (e) {
                throw new Error('Invalid select parameter');
            }
        }

        // Parse 'skip' parameter
        if (req.query.skip) {
            query.skip = parseInt(req.query.skip);
        }

        // Parse 'limit' parameter
        if (req.query.limit) {
            query.limit = parseInt(req.query.limit);
        }

        // Parse 'count' parameter
        if (req.query.count === 'true') {
            query.count = true;
        }

        return query;
    }

    // GET /api/users - List all users
    usersRoute.get(function (req, res) {
        try {
            var queryParams = parseQueryParams(req);
            var mongooseQuery = User.find(queryParams.where || {});

            // Parse 'filter' parameter (used for field projection, e.g. {"_id":1})
            if (req.query.filter) {
                try {
                    query.filter = JSON.parse(req.query.filter);
                } catch (e) {
                    throw new Error('Invalid filter parameter');
                }
            }

            // Apply sort
            if (queryParams.sort) {
                mongooseQuery = mongooseQuery.sort(queryParams.sort);
            }

            // Apply select
            if (queryParams.select) {
                mongooseQuery = mongooseQuery.select(queryParams.select);
            }

            // Apply skip
            if (queryParams.skip) {
                mongooseQuery = mongooseQuery.skip(queryParams.skip);
            }

            // Apply limit (no default limit for users)
            if (queryParams.limit) {
                mongooseQuery = mongooseQuery.limit(queryParams.limit);
            }

            // Handle count
            if (queryParams.count) {
                User.countDocuments(queryParams.where || {}).exec()
                    .then(function(count) {
                        res.status(200).json({
                            message: 'OK',
                            data: count
                        });
                    })
                    .catch(function(err) {
                        res.status(500).json({
                            message: 'Error counting users',
                            data: null
                        });
                    });
                return;
            }

            // Execute query
            mongooseQuery.exec()
                .then(function(users) {
                    res.status(200).json({
                        message: 'OK',
                        data: users
                    });
                })
                .catch(function(err) {
                    res.status(500).json({
                        message: 'Error retrieving users',
                        data: null
                    });
                });
        } catch (err) {
            res.status(400).json({
                message: err.message || 'Bad request',
                data: null
            });
        }
    });

    // POST /api/users - Create new user
    usersRoute.post(function (req, res) {
        // Validate required fields
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: 'Name and email are required',
                data: null
            });
        }

        // Set defaults
        var userData = {
            name: req.body.name,
            email: req.body.email,
            pendingTasks: req.body.pendingTasks || [],
            dateCreated: req.body.dateCreated || Date.now()
        };

        var user = new User(userData);
        
        user.save()
            .then(function(savedUser) {
                // If pendingTasks were provided, update the tasks
                if (userData.pendingTasks && userData.pendingTasks.length > 0) {
                    return Task.updateMany(
                        { _id: { $in: userData.pendingTasks } },
                        { 
                            assignedUser: savedUser._id.toString(),
                            assignedUserName: savedUser.name
                        }
                    ).then(function() {
                        return savedUser;
                    });
                }
                return savedUser;
            })
            .then(function(savedUser) {
                res.status(201).json({
                    message: 'User created successfully',
                    data: savedUser
                });
            })
            .catch(function(err) {
                if (err.code === 11000) {
                    res.status(400).json({
                        message: 'Email already exists',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Error creating user',
                        data: null
                    });
                }
            });
    });

    // GET /api/users/:id - Get user by ID
    userByIdRoute.get(function (req, res) {
        var mongooseQuery = User.findById(req.params.id);

        // Handle select parameter
        if (req.query.select) {
            try {
                var selectObj = JSON.parse(req.query.select);
                mongooseQuery = mongooseQuery.select(selectObj);
            } catch (e) {
                return res.status(400).json({
                    message: 'Invalid select parameter',
                    data: null
                });
            }
        }

        mongooseQuery.exec()
            .then(function(user) {
                if (!user) {
                    return res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                }
                res.status(200).json({
                    message: 'OK',
                    data: user
                });
            })
            .catch(function(err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Error retrieving user',
                        data: null
                    });
                }
            });
    });

    // PUT /api/users/:id - Update user
    userByIdRoute.put(function (req, res) {
        // Validate required fields
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: 'Name and email are required',
                data: null
            });
        }

        User.findById(req.params.id)
            .then(function(user) {
                if (!user) {
                    return res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                }

                // Store old pendingTasks
                var oldPendingTasks = user.pendingTasks || [];
                var newPendingTasks = req.body.pendingTasks || [];

                // Update user
                user.name = req.body.name;
                user.email = req.body.email;
                user.pendingTasks = newPendingTasks;
                if (req.body.dateCreated) {
                    user.dateCreated = req.body.dateCreated;
                }

                return user.save().then(function(updatedUser) {
                    // Update tasks: remove from old tasks, add to new tasks
                    var tasksToUnassign = oldPendingTasks.filter(function(id) {
                        return newPendingTasks.indexOf(id) === -1;
                    });
                    var tasksToAssign = newPendingTasks.filter(function(id) {
                        return oldPendingTasks.indexOf(id) === -1;
                    });

                    var promises = [];

                    // Unassign tasks - remove from this user's pendingTasks (already done) 
                    // and unassign from tasks
                    if (tasksToUnassign.length > 0) {
                        promises.push(
                            Task.updateMany(
                                { _id: { $in: tasksToUnassign } },
                                { 
                                    assignedUser: '',
                                    assignedUserName: 'unassigned'
                                }
                            )
                        );
                    }

                    // Assign new tasks - update task's assignedUser and assignedUserName,
                    // and remove from any previous user's pendingTasks
                    if (tasksToAssign.length > 0) {
                        // First, fetch the tasks to get their old assignedUser
                        promises.push(
                            Task.find({ _id: { $in: tasksToAssign } }).then(function(tasks) {
                                // Get unique list of old assigned users
                                var oldUserIds = [];
                                tasks.forEach(function(task) {
                                    if (task.assignedUser && task.assignedUser !== updatedUser._id.toString()) {
                                        if (oldUserIds.indexOf(task.assignedUser) === -1) {
                                            oldUserIds.push(task.assignedUser);
                                        }
                                    }
                                });

                                // Remove tasks from old users' pendingTasks
                                var userUpdatePromises = oldUserIds.map(function(userId) {
                                    return User.findById(userId).then(function(oldUser) {
                                        if (oldUser) {
                                            oldUser.pendingTasks = oldUser.pendingTasks.filter(function(id) {
                                                return tasksToAssign.indexOf(id.toString()) === -1;
                                            });
                                            return oldUser.save();
                                        }
                                    });
                                });

                                return Promise.all(userUpdatePromises).then(function() {
                                    // Now update the tasks
                                    return Task.updateMany(
                                        { _id: { $in: tasksToAssign } },
                                        { 
                                            assignedUser: updatedUser._id.toString(),
                                            assignedUserName: updatedUser.name
                                        }
                                    );
                                });
                            })
                        );
                    }

                    return Promise.all(promises).then(function() {
                        return updatedUser;
                    });
                });
            })
            .then(function(updatedUser) {
                res.status(200).json({
                    message: 'User updated successfully',
                    data: updatedUser
                });
            })
            .catch(function(err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                } else if (err.code === 11000) {
                    res.status(400).json({
                        message: 'Email already exists',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Error updating user',
                        data: null
                    });
                }
            });
    });

    // DELETE /api/users/:id - Delete user
    userByIdRoute.delete(function (req, res) {
        User.findById(req.params.id)
            .then(function(user) {
                if (!user) {
                    return res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                }

                var pendingTasks = user.pendingTasks || [];

                // Unassign all pending tasks
                var unassignPromise = pendingTasks.length > 0
                    ? Task.updateMany(
                        { _id: { $in: pendingTasks } },
                        { 
                            assignedUser: '',
                            assignedUserName: 'unassigned'
                        }
                    )
                    : Promise.resolve();

                return unassignPromise.then(function() {
                    return user.remove();
                });
            })
            .then(function() {
                res.status(204).send();
            })
            .catch(function(err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'User not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Error deleting user',
                        data: null
                    });
                }
            });
    });

    return router;
};

