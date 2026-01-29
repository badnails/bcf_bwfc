FrostByte Logistics was highly impressed with your work on the network 
validation system and now values your expertise even more, and is confident 
to present you with more complex tasks of the industry. 
One of their partner companies, Valerix, operates a massive e-commerce 
platform, processes thousands of orders per minute, and must deliver both 
deadline agreements and correct orders. 
On a busy Tuesday morning, their team sits down with the FrostByte systems 
architect to discuss a major problem. After a while, you are called in and 
presented with the challenge -  
Currently, their system is a single monolithic server. It handles everything - 
taking orders, tracking inventory, updating shipments, and notifying users.  
It works... most of the time. But there are significant issues: 
●  If inventory updates slow down, the entire order flow stalls. 
●  Adding new features is risky because all components are tightly 
coupled. 
●  Partial failures, such as database locks or network delays, can cascade 
into long delays for users. 
 
You notice that the platform services are built on a poorly designed database 
and a heavily accumulated legacy codebase. 
All together, the system is ill-equipped to handle sudden traffic spikes, and 
the development team struggles to safely introduce new features or scale the 
platform to support increasing demand. 
Hence, you decide to break this monolith into microservices.  
Your system architect gives you the freedom of designing the appropriate 
database schema and the microservice architecture for the new server.  
However, he insists that, in any case, the following two services should be 
included as separate services in your design to maintain a necessary and 
proper logical boundary. 
●  Order service – receives orders, validates them, and coordinates 
downstream processes.  
●  Inventory service – manages stock levels and updates them when 
orders are shipped. 
 
The Order service will call the Inventory service to update inventory whenever 
an order is ready to ship.



The Vanishing Response 
 
Designing a robust microservice architecture is no easy feat, but a team like 
yours must not just stop here, and must not be careless about the reliability of 
a service you will provide.  
 
So think about this - 
In the real world, systems are messy.  
Networks fail, services start, or restart later than expected, and there can 
always be noisy neighbours (Yes, they are everywhere).   
To try and tackle these issues, first, we will simulate them by introducing a 
“gremlin Latency” - that is, your Inventory Service will sometimes delay its 
response by several seconds.  
This is how it will work - 
●  The Inventory service should sometimes show significant latency in a 
predictable, deterministic pattern while responding to the Order Service.  
●  The Order service should continue to work smoothly even when this 
happens. It should not keep waiting forever for a slow response. 
 
If the Inventory service takes too long to reply, the Order service should stop 
waiting and return a clear appropriate message to the user. 
This was not part of the monolith but is now introduced to test the resilience of 
your new architecture. 
Your goal is to ensure that the Order Service can handle these delays 
gracefully, returning timeouts or user-friendly error messages instead of 
freezing.  
Beyond that, the system should be modular, allowing it to add services like 
notifications, payments, or analytics without breaking the core flow, for the 
Valerix Engineers


A Schrödinger’s Warehouse 
 
Just about when you are happy with all the hard work you have put in so far, 
your system architect says - stop.  
He introduces you to a very significant possibility of your server behaviour, 
when it goes into the production, a ghost in your server.  
 
You’ve handled service latency, and you’ve handled service monitoring.  
But now, you must handle partial success cases your server can arise in the 
production.  
 
Welcome to the Schrödinger's Warehouse - 
 
Consider this regular scenario. Your client platform receives an order to buy 
gaming consoles. Your Order Service handles the process and when the order 
is shipped, it tells the Inventory Service to appropriately adjust the stock.  
In a high stress environment, and with a poor network infrastructure, even with 
these regular orders, your server starts to misbehave.  
What might happen, is that - 
 
●  Immediately after the database commit, but before the HTTP response 
is sent back to the Order service, the Inventory Service process crashes. 
 
●  The server might have processed the order successfully, but before it 
could respond to the customer, a noise signal might come into the way, 
and return an Internal Server Error to the client. 
 
And what it might cause - is that now client and server are aware of two 
different states of the situation. 
 
This uncertain “quantum inventory”, is diagnosed as a severe headache by 
your system architect, and you are required to build a solution in your server 
that will work around these network issues, or sudden internal service crashes, 
and do exactly what it is supposed to do