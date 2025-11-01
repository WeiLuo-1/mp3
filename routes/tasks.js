var Task = require('../models/task');
var User = require('../models/user');

module.exports = function (router) {
    var tasksRoute = router.route('/tasks');
    var taskByIdRoute = router.route('/tasks/:id');

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
        } else {
            // Default limit of 100 for tasks
            query.limit = 100;
        }

        // Parse 'count' parameter
        if (req.query.count === 'true') {
            query.count = true;
        }

        return query;
    }

    // GET /api/tasks - List all tasks
    tasksRoute.get(function (req, res) {
        try {
            var queryParams = parseQueryParams(req);
            var mongooseQuery = Task.find(queryParams.where || {});

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

            // Apply limit (default 100 for tasks)
            mongooseQuery = mongooseQuery.limit(queryParams.limit);

            // Handle count
            if (queryParams.count) {
                Task.countDocuments(queryParams.where || {}).exec()
                    .then(function(count) {
                        res.status(200).json({
                            message: 'OK',
                            data: count
                        });
                    })
                    .catch(function(err) {
                        res.status(500).json({
                            message: 'Error counting tasks',
                            data: null
                        });
                    });
                return;
            }

            // Execute query
            mongooseQuery.exec()
                .then(function(tasks) {
                    res.status(200).json({
                        message: 'OK',
                        data: tasks
                    });
                })
                .catch(function(err) {
                    res.status(500).json({
                        message: 'Error retrieving tasks',
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

    // POST /api/tasks - Create new task
    tasksRoute.post(function (req, res) {
        // Validate required fields
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: 'Name and deadline are required',
                data: null
            });
        }

        // Set defaults
        var taskData = {
            name: req.body.name,
            description: req.body.description || '',
            deadline: req.body.deadline,
            completed: req.body.completed !== undefined ? req.body.completed : false,
            assignedUser: req.body.assignedUser || '',
            assignedUserName: req.body.assignedUserName || 'unassigned',
            dateCreated: req.body.dateCreated || Date.now()
        };

        // If assignedUser is provided, get the user name
        var userLookupPromise = taskData.assignedUser 
            ? User.findById(taskData.assignedUser).then(function(user) {
                if (user && (!taskData.assignedUserName || taskData.assignedUserName === 'unassigned')) {
                    taskData.assignedUserName = user.name;
                }
                return user;
            }).catch(function() {
                return null;
            })
            : Promise.resolve(null);

        return userLookupPromise.then(function(user) {
            var task = new Task(taskData);
            
            return task.save().then(function(savedTask) {
                // If assignedUser is provided and task is not completed, add to user's pendingTasks
                if (taskData.assignedUser && !taskData.completed && user) {
                    // Add task to user's pendingTasks if not already there
                    if (user.pendingTasks.indexOf(savedTask._id.toString()) === -1) {
                        user.pendingTasks.push(savedTask._id.toString());
                        return user.save().then(function() {
                            return savedTask;
                        });
                    }
                }
                return savedTask;
            });
        })
            .then(function(savedTask) {
                res.status(201).json({
                    message: 'Task created successfully',
                    data: savedTask
                });
            })
            .catch(function(err) {
                res.status(500).json({
                    message: 'Error creating task',
                    data: null
                });
            });
    });

    // GET /api/tasks/:id - Get task by ID
    taskByIdRoute.get(function (req, res) {
        var mongooseQuery = Task.findById(req.params.id);

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
            .then(function(task) {
                if (!task) {
                    return res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                }
                res.status(200).json({
                    message: 'OK',
                    data: task
                });
            })
            .catch(function(err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Error retrieving task',
                        data: null
                    });
                }
            });
    });

    // PUT /api/tasks/:id - Update task
    taskByIdRoute.put(function (req, res) {
        // Validate required fields
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: 'Name and deadline are required',
                data: null
            });
        }

        Task.findById(req.params.id)
            .then(function(task) {
                if (!task) {
                    return res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                }

                // Store old assignedUser and completed status
                var oldAssignedUser = task.assignedUser || '';
                var oldCompleted = task.completed;
                var newAssignedUser = req.body.assignedUser || '';
                var newAssignedUserName = req.body.assignedUserName || 'unassigned';
                var newCompleted = req.body.completed !== undefined ? req.body.completed : false;

                // If assignedUser is provided, get the user name if not provided
                var userLookupPromise = newAssignedUser && (!req.body.assignedUserName || req.body.assignedUserName === 'unassigned')
                    ? User.findById(newAssignedUser).then(function(user) {
                        if (user) {
                            newAssignedUserName = user.name;
                        }
                        return user;
                    }).catch(function() {
                        return null;
                    })
                    : Promise.resolve(null);

                return userLookupPromise.then(function(newUser) {
                    // Update task
                    task.name = req.body.name;
                    task.description = req.body.description !== undefined ? req.body.description : task.description;
                    task.deadline = req.body.deadline;
                    task.completed = newCompleted;
                    task.assignedUser = newAssignedUser;
                    task.assignedUserName = newAssignedUserName;
                    if (req.body.dateCreated) {
                        task.dateCreated = req.body.dateCreated;
                    }

                    return task.save().then(function(updatedTask) {
                    var promises = [];
                    var taskId = updatedTask._id.toString();

                    // Handle old assigned user
                    if (oldAssignedUser) {
                        // Remove from old user's pendingTasks if:
                        // 1. Task was not completed but now is completed, OR
                        // 2. Task is being reassigned to a different user, OR
                        // 3. Task is being unassigned
                        if (!oldCompleted && (newCompleted || newAssignedUser !== oldAssignedUser || !newAssignedUser)) {
                            promises.push(
                                User.findById(oldAssignedUser).then(function(oldUser) {
                                    if (oldUser) {
                                        oldUser.pendingTasks = oldUser.pendingTasks.filter(function(id) {
                                            return id !== taskId;
                                        });
                                        return oldUser.save();
                                    }
                                })
                            );
                        }
                    }

                    // Add to new user's pendingTasks if task is assigned and not completed
                    if (newAssignedUser && !newCompleted) {
                        // Add if: user changed, or same user but task was completed before
                        if (newAssignedUser !== oldAssignedUser || oldCompleted) {
                            if (newUser) {
                                // Only add if not already in the list
                                if (newUser.pendingTasks.indexOf(taskId) === -1) {
                                    newUser.pendingTasks.push(taskId);
                                    promises.push(newUser.save());
                                }
                            } else {
                                // Need to fetch the user
                                promises.push(
                                    User.findById(newAssignedUser).then(function(user) {
                                        if (user && user.pendingTasks.indexOf(taskId) === -1) {
                                            user.pendingTasks.push(taskId);
                                            return user.save();
                                        }
                                    })
                                );
                            }
                        } else if (newAssignedUser === oldAssignedUser && !oldCompleted && newUser) {
                            // Same user, task still pending - ensure it's in the list
                            if (newUser.pendingTasks.indexOf(taskId) === -1) {
                                newUser.pendingTasks.push(taskId);
                                promises.push(newUser.save());
                            }
                        } else if (newAssignedUser === oldAssignedUser && !oldCompleted && !newUser) {
                            // Same user, but we didn't fetch the user - fetch it to ensure task is in list
                            promises.push(
                                User.findById(newAssignedUser).then(function(user) {
                                    if (user && user.pendingTasks.indexOf(taskId) === -1) {
                                        user.pendingTasks.push(taskId);
                                        return user.save();
                                    }
                                })
                            );
                        }
                    }

                    return Promise.all(promises).then(function() {
                        return updatedTask;
                    });
                });
                }); // Close userLookupPromise.then
            })
            .then(function(updatedTask) {
                res.status(200).json({
                    message: 'Task updated successfully',
                    data: updatedTask
                });
            })
            .catch(function(err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Error updating task',
                        data: null
                    });
                }
            });
    });

    // DELETE /api/tasks/:id - Delete task
    taskByIdRoute.delete(function (req, res) {
        Task.findById(req.params.id)
            .then(function(task) {
                if (!task) {
                    return res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                }

                var assignedUser = task.assignedUser;
                var taskId = task._id.toString();
                var wasCompleted = task.completed;

                // Remove from user's pendingTasks if task was assigned and not completed
                var removeFromUserPromise = assignedUser && !wasCompleted
                    ? User.findById(assignedUser).then(function(user) {
                        if (user) {
                            user.pendingTasks = user.pendingTasks.filter(function(id) {
                                return id !== taskId;
                            });
                            return user.save();
                        }
                    })
                    : Promise.resolve();

                return removeFromUserPromise.then(function() {
                    return task.remove();
                });
            })
            .then(function() {
                res.status(204).send();
            })
            .catch(function(err) {
                if (err.name === 'CastError') {
                    res.status(404).json({
                        message: 'Task not found',
                        data: null
                    });
                } else {
                    res.status(500).json({
                        message: 'Error deleting task',
                        data: null
                    });
                }
            });
    });

    return router;
};

